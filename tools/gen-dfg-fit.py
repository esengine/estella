"""The split-sum environment BRDF of GGX (height-correlated Smith masking, alpha = roughness^2), integrated numerically, and the fit the
shaders carry in its place: envBRDFApprox in src/esengine/resource/ShaderParser.cpp, in both languages.

It returns (A, B), the scale and bias of F0 over the hemisphere. Karis' analytic fit, which the engine carried before, is 21% low for a metal
at roughness 0.5 seen head-on and 80% off at worst (the render lab's balls and cards found it); a table is the usual carrier, but it costs
a texture unit, and an array a WGSL shader indexes at run time costs registers. This fits the two sums the shading reads, A + B (a metal)
and 0.04 A + B (a dielectric), in Legendre polynomials of NdotV and roughness plus a few terms in 1 / (NdotV + 0.1) for the turn at grazing
views, weighted by relative error. The coefficients stay below one, so the sum is well conditioned in 32-bit floats. (Locals are not
named s0..s7 or t0..t7: the WGSL binding scan reads those as texture units.)

python tools/gen-dfg-fit.py            prints the worst and mean error of the fit and of Karis' against the integral
python tools/gen-dfg-fit.py --code     also prints the WGSL and the GLSL (as C++ string lines) to paste
"""
import sys

import numpy as np
from numpy.polynomial import legendre as L

N = 32
SAMPLES = 8192
DX, DY, INV = 7, 7, 5
X0 = 0.02


def hammersley(n):
    i = np.arange(n, dtype=np.uint64)
    b = i.copy()
    b = ((b << np.uint64(16)) | (b >> np.uint64(16))) & np.uint64(0xffffffff)
    b = ((b & np.uint64(0x55555555)) << np.uint64(1)) | ((b & np.uint64(0xAAAAAAAA)) >> np.uint64(1))
    b = ((b & np.uint64(0x33333333)) << np.uint64(2)) | ((b & np.uint64(0xCCCCCCCC)) >> np.uint64(2))
    b = ((b & np.uint64(0x0F0F0F0F)) << np.uint64(4)) | ((b & np.uint64(0xF0F0F0F0)) >> np.uint64(4))
    b = ((b & np.uint64(0x00FF00FF)) << np.uint64(8)) | ((b & np.uint64(0xFF00FF00)) >> np.uint64(8))
    return (i.astype(np.float64) + 0.5) / n, b.astype(np.float64) / 2.0 ** 32


def lam(alpha, cos):
    cos = np.clip(cos, 1e-6, 1.0)
    tan2 = (1 - cos * cos) / (cos * cos)
    return (-1 + np.sqrt(1 + alpha * alpha * tan2)) / 2


def integrate(nov, rough):
    alpha = max(rough * rough, 1e-4)
    u1, u2 = hammersley(SAMPLES)
    phi = 2 * np.pi * u1
    cos_t = np.sqrt((1 - u2) / (1 + (alpha * alpha - 1) * u2))
    sin_t = np.sqrt(1 - cos_t * cos_t)
    h = np.stack([sin_t * np.cos(phi), sin_t * np.sin(phi), cos_t], 1)
    v = np.array([np.sqrt(1 - nov * nov), 0.0, nov])
    voh = h @ v
    l = 2 * voh[:, None] * h - v
    nol = l[:, 2]
    noh = h[:, 2]
    ok = nol > 0
    g2 = 1.0 / (1.0 + lam(alpha, nov) + lam(alpha, nol))
    gvis = g2 * voh / np.maximum(noh * nov, 1e-8)
    fc = (1 - voh) ** 5
    return np.where(ok, (1 - fc) * gvis, 0).mean(), np.where(ok, fc * gvis, 0).mean()


xs = np.linspace(X0, 1.0, N)
ys = np.linspace(0.0, 1.0, N)
A = np.zeros((N, N))
B = np.zeros((N, N))
for j, r in enumerate(ys):
    for i, x in enumerate(xs):
        A[j, i], B[j, i] = integrate(x, r)
X, Y = np.meshgrid(xs, ys)


def leg(t, n):
    return np.stack([L.legval(t, [0] * k + [1]) for k in range(n)], -1)


def basis(x, y):
    px = leg(2 * (x - X0) / (1 - X0) - 1, DX)
    py = leg(2 * y - 1, DY)
    cols = [px[..., p] * py[..., q] for p in range(DX) for q in range(DY)]
    g = 1 / (x + 0.1)
    cols += [py[..., q] * g for q in range(INV)]
    return np.stack(cols, -1)


M = basis(X.ravel(), Y.ravel())
coef = {}
fit = {}
for name, target in (('s1', A + B), ('s0', 0.04 * A + B)):
    w = 1 / np.maximum(target.ravel(), 1e-3)
    coef[name] = np.linalg.lstsq(M * w[:, None], target.ravel() * w, rcond=None)[0]
    fit[name] = (M @ coef[name]).reshape(N, N)
fa = (fit['s1'] - fit['s0']) / 0.96
fb = fit['s1'] - fa


def karis(x, r):
    c0 = np.array([-1, -0.0275, -0.572, 0.022])
    c1 = np.array([1, 0.0425, 1.04, -0.04])
    rr = r[..., None] * c0 + c1
    a004 = np.minimum(rr[..., 0] ** 2, np.exp2(-9.28 * x)) * rr[..., 0] + rr[..., 1]
    return -1.04 * a004 + rr[..., 2], 1.04 * a004 + rr[..., 3]


ka, kb = karis(X, Y)
for name, ea, eb in (('fit', fa, fb), ('karis', ka, kb)):
    for f0 in (0.04, 1.0):
        true = f0 * A + B
        approx = f0 * ea + eb
        rel = np.abs(approx - true) / np.maximum(true, 1e-3)
        print('%-6s F0 %.2f   worst relative error %.3f   mean %.4f   (roughness 0.5, NdotV 1: integral %.4f, this %.4f)'
              % (name, f0, rel.max(), rel.mean(), true[N // 2, -1], approx[N // 2, -1]))

if '--code' in sys.argv:
    def legendre_lets(var, t, n, lang):
        out = []
        decl = 'let' if lang == 'wgsl' else 'highp float'
        out.append('%s %s0 = 1.0;' % (decl, var))
        out.append('%s %s1 = %s;' % (decl, var, t))
        for k in range(1, n - 1):
            out.append('%s %s%d = (%.1f * %s * %s%d - %.1f * %s%d) / %.1f;' % (decl, var, k + 1, 2 * k + 1, t, var, k, k, var, k - 1, k + 1))
        return out

    def row_expr(cs):
        out = '%.7f' % cs[0]
        for q, c in enumerate(cs[1:], 1):
            out += ' + %.7f * py%d' % (c, q)
        return out.replace('+ -', '- ')

    def sum_expr(c):
        # A row for each power of x, so a product of two polynomials is read once: this runs for every lit pixel, and spelled out term by
        # term it was twice the multiplications, on a phone most of what the lighting costs.
        parts = ['(%s)' % row_expr(c[:DY])]
        parts += ['px%d * (%s)' % (p, row_expr(c[p * DY:(p + 1) * DY])) for p in range(1, DX)]
        parts.append('g * (%s)' % row_expr(c[DX * DY:]))
        return ' + '.join(parts)

    for lang in ('wgsl', 'glsl'):
        decl = 'let' if lang == 'wgsl' else 'highp float'
        lines = []
        tx = '(2.0 * (clamp(NdotV, %.2f, 1.0) - %.2f) / %.2f - 1.0)' % (X0, X0, 1 - X0)
        lines.append('%s tx = %s;' % (decl, tx))
        lines.append('%s ty = 2.0 * clamp(roughness, 0.0, 1.0) - 1.0;' % decl)
        lines += legendre_lets('px', 'tx', DX, lang)
        lines += legendre_lets('py', 'ty', DY, lang)
        lines.append('%s g = 1.0 / (clamp(NdotV, %.2f, 1.0) + 0.1);' % (decl, X0))
        lines.append('%s sumMetal = %s;' % (decl, sum_expr(coef['s1'])))
        lines.append('%s sumDielectric = %s;' % (decl, sum_expr(coef['s0'])))
        lines.append('%s scale = (sumMetal - sumDielectric) / 0.96;' % decl)
        lines.append('return %s(scale, sumMetal - scale);' % ('vec2f' if lang == 'wgsl' else 'vec2'))
        print('----', lang)
        for l in lines:
            print(l)
