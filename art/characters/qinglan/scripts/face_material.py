"""Continuous lip colour evaluated before baking to the skin UV map."""
from common import *

def add_lip_shader(mat,base_socket):
    nt=mat.node_tree;nodes=nt.nodes;links=nt.links
    def math_node(op,*args):
        n=nodes.new('ShaderNodeMath');n.operation=op
        for i,arg in enumerate(args):
            if isinstance(arg,(float,int)):n.inputs[i].default_value=arg
            else:links.new(arg,n.inputs[i])
        return n.outputs[0]
    geom=nodes.new('ShaderNodeNewGeometry');sep=nodes.new('ShaderNodeSeparateXYZ');links.new(geom.outputs['Position'],sep.inputs[0])
    x=sep.outputs['X'];y=sep.outputs['Y'];z=sep.outputs['Z']
    xa=math_node('ABSOLUTE',x)
    cusp=math_node('EXPONENT',math_node('MULTIPLY',math_node('POWER',math_node('DIVIDE',math_node('SUBTRACT',xa,.007),.0045),2),-1))
    center=math_node('ADD',1.5272,math_node('MULTIPLY',.0008,cusp))
    xm=math_node('POWER',math_node('DIVIDE',xa,.0240),6)
    zm=math_node('POWER',math_node('DIVIDE',math_node('SUBTRACT',z,center),.0061),6)
    mask=math_node('EXPONENT',math_node('MULTIPLY',math_node('ADD',xm,zm),-1))
    mask=math_node('MULTIPLY',mask,math_node('LESS_THAN',y,-.128))
    mix=nodes.new('ShaderNodeMixRGB');links.new(mask,mix.inputs[0]);links.new(base_socket,mix.inputs[1])
    mix.inputs[2].default_value=tuple(srgb(a) for a in (.58,.25,.28))+(1,)
    bs=next(n for n in nodes if n.type=='BSDF_PRINCIPLED')
    links.new(mix.outputs[0],bs.inputs['Base Color'])
    links.new(math_node('SUBTRACT',.49,math_node('MULTIPLY',mask,.09)),bs.inputs['Roughness'])
