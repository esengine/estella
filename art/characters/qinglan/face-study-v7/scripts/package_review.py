"""Record final provenance and the actual review status, including failed gates."""
import json,hashlib
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
source=json.loads((ROOT.parent/'face-study-v5/provenance.json').read_text(encoding='utf-8'))
verification=json.loads((ROOT/'review/verification.json').read_text())
keys=json.loads((ROOT/'review/accepted-key-values.json').read_text())
sha=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
provenance={
    'asset':'Qinglan V7 reference-led control-cage proportion study',
    'status':'editable_review_candidate_not_art_or_production_approved',
    'created':'2026-10-29',
    'source':source['source'],
    'parent_file':'../face-study-v5/qinglan-face-candidate.blend',
    'parent_sha256':sha(ROOT.parent/'face-study-v5/qinglan-face-candidate.blend'),
    'current_file':'qinglan-identity-cage.blend','current_sha256':sha(ROOT/'qinglan-identity-cage.blend'),
    'reference':{'file':'../references/qinglan-face-target.png','sha256':sha(ROOT.parent/'references/qinglan-face-target.png'),'calibrated':False},
    'workflow':{'blender':'5.2.1 LTS','skill_revision':'d44410f058991f677ccf733a8e86ce95110857eb',
        'skills':['scenario-blender-expert','scenario-blender-sculpting','scenario-blender-retopology','estella-character-production'],
        'execution':'Initial control edits over the live Blender MCP connection; after a Blender process crash, recovered from a stage copy and continued through headless CLI. No computer use, no newly launched GUI, no paid add-on activation.',
        'native_brushes_this_version':False,'comparison_images':'Unaltered reference/render pixels arranged with Matplotlib; approximate eye/eye-chin alignment.'},
    'final_keys':keys,
    'limits':['Facial identity needs further work','Strict new-crossing-pair check fails at Multires level 2','Internal source contacts and neck attachment unfinished','No rig, expression, UV, runtime export or Estella acceptance']}
(ROOT/'provenance.json').write_text(json.dumps(provenance,ensure_ascii=False,indent=2),encoding='utf-8')
review={'status':'needs_revision','stage':'Primary facial proportion comparison complete; head-identity gate remains open',
    'accepted_changes':['Mouth region raised toward the front reference','Reduced mouth width','Moderate jaw taper and rounded chin edge','Extended eye aperture with coordinated globe/iris changes','Raised and shortened source ears','Brow silhouette proxies'],
    'rejected_changes':['Broad cheek fill and constrained cheek envelope produced undesirable transitions','Extra upper-lip lift and forced lip-shell separation changed the intended closed-mouth expression'],
    'remaining_art_issues':['Cheekbone-to-jaw transition remains too angular','Lids and orbital mass remain too heavy for the reference','Nose/lip surface planes and chin still carry the base-mesh identity','Brows are simple proxies; no final hairline, lashes or groom'],
    'technical':{'render_structure_gate':True,'strict_contact_check':verification['checks_passed'],
        'cage_source_crossings':verification['levels']['0']['source_confirmed_crossings'],
        'cage_new_crossings':verification['levels']['0']['new_confirmed_crossings'],
        'level2_source_crossings':verification['levels']['2']['source_confirmed_crossings'],
        'level2_current_crossings':verification['levels']['2']['current_confirmed_crossings'],
        'level2_new_pairs':verification['levels']['2']['new_confirmed_crossings']},
    'reviewed_views':['after-front.png','after-profile.png','after-threequarter.png','after-low.png','reference-camera-front.png','reference-camera-profile.png','reference-camera-threequarter.png','cage-front.png','cage-threequarter.png','reference-overlay.png','reference-multiview.png'],
    'next_work':'Remain at the head-identity gate. Correct cheek planes and lid thickness in small local areas, compare fixed renders, and clean the lip contact topology before production export.'}
(ROOT/'review/art-review.json').write_text(json.dumps(review,ensure_ascii=False,indent=2),encoding='utf-8')
for path in (ROOT/'review').glob('*.json'):json.loads(path.read_text(encoding='utf-8'))
print(json.dumps({'blend_bytes':(ROOT/'qinglan-identity-cage.blend').stat().st_size,'status':review['status'],'strict_contact_check':review['technical']['strict_contact_check']}))
