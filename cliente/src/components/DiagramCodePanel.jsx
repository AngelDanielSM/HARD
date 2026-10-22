import { useMemo, useState } from 'react';
import { useEscape } from '../hooks/useEscape.js';
import { Code, Copy, Download, FileText, X } from 'lucide-react';

function sceneFor(nodes,edges,project,sheet,catalog,distribution={}){return {distribution,library:(catalog||[]).map(c=>({componentId:c.id,name:c.nombre,model:c.modelo,pins:c.pin_count||c.pinout?.length||0,family:c.familia||"Circular"})),project:{name:project.nombre,description:project.descripcion||'',sheet},splices:nodes.filter(n=>n.type==='splice').map(n=>({id:n.id,name:n.data.label,color:n.data.color||'#4388d1',x:Math.round(n.position.x),y:Math.round(n.position.y)})),connectors:nodes.filter(n=>n.type==='component').map(n=>({id:n.id,componentId:n.data.componentId,name:n.data.label,model:n.data.modelo||'',family:n.data.familia||'Circular',gender:n.data.genero||'Hembra',pins:n.data.pinout||[],x:Math.round(n.position.x),y:Math.round(n.position.y)})),wires:edges.map(e=>({id:e.id,from:e.source,fromPin:Number(e.sourceHandle||1),to:e.target,toPin:Number(e.targetHandle||1),fromType:nodes.find(n=>n.id===e.source)?.type==='splice'?'splice':'connector',toType:nodes.find(n=>n.id===e.target)?.type==='splice'?'splice':'connector',bundle:e.data?.grupo_cable||'',bundle_color:e.data?.color_funda||'#59636a',label:e.data?.etiqueta||'',color:e.data?.color||'#38bdf8',gauge:e.data?.calibre||'18 AWG',material:e.data?.material||'Cobre',length_mm:e.data?.longitud_mm??null})),removeConnectorIds:[],removeWireIds:[],removeSpliceIds:[]};}
function pythonSource(scene){const json=JSON.stringify(JSON.stringify(scene),null,0);return `# Generado por Harness Lab. Requiere solo Python 3.
# Ejecuta: python diagrama_arnes.py
import json
import math
from pathlib import Path
from xml.sax.saxutils import escape

scene = json.loads(${json})
parts = {p["id"]: p for p in scene["connectors"]}
parts.update({p["id"]: p for p in scene.get("splices", [])})
width, height = 1587, 1122
svg = [f'<svg xmlns="http://www.w3.org/2000/svg" width="{width}" height="{height}" viewBox="0 0 {width} {height}">']
svg += ['<rect width="100%" height="100%" fill="white"/>', '<rect x="24" y="24" width="1539" height="1074" fill="none" stroke="#222" stroke-width="2"/>']
# Dibuja primero los cables para que queden debajo de los conectores.
for w in scene["wires"]:
    a, b = parts.get(w["from"]), parts.get(w["to"])
    if not a or not b: continue
    angle_a = 2 * math.pi * (w["fromPin"] - 1) / max(len(a.get("pins", [None])), 1) - math.pi / 2
    angle_b = 2 * math.pi * (w["toPin"] - 1) / max(len(b.get("pins", [None])), 1) - math.pi / 2
    x1, y1 = a["x"] + 70 + 43 * math.cos(angle_a), a["y"] + 70 + 43 * math.sin(angle_a)
    x2, y2 = b["x"] + 70 + 43 * math.cos(angle_b), b["y"] + 70 + 43 * math.sin(angle_b)
    color = w["color"]
    svg.append(f'<path d="M{x1},{y1} C{x1+60},{y1} {x2-60},{y2} {x2},{y2}" fill="none" stroke="{color}" stroke-width="4"/>')
    if w["label"] or w["gauge"]: svg.append(f'<text x="{(x1+x2)//2}" y="{(y1+y2)//2-8}" font-family="Arial" font-size="16" fill="#17232a">{escape(w["label"] or w["gauge"])} · {w.get("length_mm") or ""} mm</text>')
for p in scene["connectors"]:
    x, y = p["x"], p["y"]
    svg += [f'<g transform="translate({x},{y})"><circle cx="70" cy="70" r="48" fill="#e8edf0" stroke="#263b46" stroke-width="5"/><circle cx="70" cy="70" r="36" fill="#cbd6db" stroke="#687f89" stroke-width="2"/><text x="70" y="135" text-anchor="middle" font-family="Arial" font-size="15">{escape(p["name"])}</text><text x="70" y="155" text-anchor="middle" font-family="Arial" font-size="11">{escape(p["model"])} · {escape(p["gender"])}</text></g>']
    for i, pin in enumerate(p["pins"]):
        angle = 2 * math.pi * i / max(len(p["pins"]), 1) - math.pi / 2
        px, py = 70 + 27 * math.cos(angle), 70 + 27 * math.sin(angle)
        svg.append(f'<circle cx="{x+px:.1f}" cy="{y+py:.1f}" r="4" fill="#526b77" stroke="white" stroke-width="1"/>')
    # Tabla de distribución compacta vinculada a la huella del conector.
    for i, pin in enumerate(p["pins"]):
        svg.append(f'<text x="{x+125}" y="{y+16+i*13}" font-family="Arial" font-size="9" fill="#26363d">{i+1}. {escape(pin or "NC")}</text>')
# Los empalmes se dibujan como diamantes y concentran varias ramas eléctricas.
for splice in scene.get("splices", []):
    x, y = splice["x"], splice["y"]
    svg.append(f'<path d="M{x+70},{y+42} l28,28 -28,28 -28,-28 Z" fill="#eaf2fc" stroke="{splice.get("color", "#4388d1")}" stroke-width="3" stroke-dasharray="6 4"/>')
    svg.append(f'<text x="{x+70}" y="{y+74}" text-anchor="middle" font-family="Arial" font-size="10">{escape(splice["name"])}</text>')
# Tabla de cableado con origen/destino, calibre, color y longitud de diseño.
svg += ['<rect x="28" y="835" width="1020" height="230" fill="white" stroke="#263238"/>',
        '<text x="42" y="858" font-family="Arial" font-size="12" font-weight="bold">LISTA DE CABLES</text>']
for i, w in enumerate(scene["wires"][:12]):
    y = 882 + i * 14
    text = f'{w["label"] or "Cable"} · {w["from"]}:{w["fromPin"]} → {w["to"]}:{w["toPin"]} · {w["gauge"]} · {w["color"]} · {w.get("length_mm") or "—"} mm'
    svg.append(f'<text x="42" y="{y}" font-family="Arial" font-size="9">{escape(text)}</text>')
sheet = scene["project"]["sheet"]
svg += ['<rect x="1130" y="970" width="430" height="122" fill="white" stroke="#263238"/>',
        f'<text x="1145" y="995" font-family="Arial" font-size="11">{escape(sheet.get("titulo", "DIAGRAMA DE ARNÉS"))}</text>',
        f'<text x="1145" y="1020" font-family="Arial" font-size="10">{escape(sheet.get("proyecto", scene["project"]["name"]))} · REV {escape(sheet.get("revision", "A"))}</text>',
        f'<text x="1145" y="1045" font-family="Arial" font-size="9">DIBUJÓ: {escape(sheet.get("dibujante", "—"))} · FECHA: {escape(sheet.get("fecha", "—"))}</text>', '</svg>']
Path("diagrama_arnes.svg").write_text("\\n".join(svg), encoding="utf-8")
print("Archivo generado: diagrama_arnes.svg")
`;}
function tex(value){const special={'\\':'\\textbackslash{}','{':'\\{','}':'\\}','$':'\\$','&':'\\&','#':'\\#','%':'\\%','_':'\\_'};return String(value??'').replace(/[\\{}$&#%_]/g,ch=>special[ch]).replaceAll('^','\\textasciicircum{}').replaceAll('~','\\textasciitilde{}')}
function tikzSource(scene){
  const palette=[...new Set(scene.wires.map(w=>(w.color||'#38bdf8').replace('#','').toUpperCase()))];
  const defs=palette.map((color,i)=>`\\definecolor{harness${i}}{HTML}{${color}}`).join('\\n');
  const parts=[...scene.connectors.map(p=>`\\node[draw,circle,minimum size=1.35cm,fill=gray!12] (c${p.id}) at (${(p.x/100).toFixed(2)},${(-p.y/100).toFixed(2)}) {${tex(p.name||'Conector')}};\\node[font=\\scriptsize,anchor=north] at (c${p.id}.south) {${tex(p.model||'')} · ${p.pins.length} pines};`),...(scene.splices||[]).map(p=>`\\node[draw,diamond,aspect=2,fill=blue!8,dashed] (c${p.id}) at (${(p.x/100).toFixed(2)},${(-p.y/100).toFixed(2)}) {${tex(p.name||'CRIMP')}};`)].join('\\n');
  const wires=scene.wires.map(w=>{const color=(w.color||'#38bdf8').replace('#','').toUpperCase(),i=palette.indexOf(color);return `\\draw[line width=1.4pt,draw=harness${i},rounded corners=4pt] (c${w.from}.east) -- ++(0.8,0) |- node[midway,above,fill=white,inner sep=2pt] {${tex((w.bundle?w.bundle+' · ':'')+(w.label||w.gauge))}} (c${w.to}.west);`;}).join('\\n');
  return `% Generado por Harness Lab. Compile con LuaLaTeX o pdfLaTeX + TikZ.\n\\documentclass[tikz,border=8mm]{standalone}\n\\usepackage{xcolor}\n\\usepackage{tikz}\n${defs}\n\\begin{document}\n\\begin{tikzpicture}[x=1cm,y=1cm]\n${parts}\n${wires}\n\\end{tikzpicture}\n\\end{document}\n`;
}

export default function DiagramCodePanel({nodes,edges,project,sheet,distribution={},catalog,onApply,onClose}){const[format,setFormat]=useState('json'),[json,setJson]=useState('');useEscape(onClose,true);const scene=useMemo(()=>sceneFor(nodes,edges,project,sheet,catalog,distribution),[nodes,edges,project,sheet,distribution]);const source=format==='python'?pythonSource(scene):format==='tikz'?tikzSource(scene):JSON.stringify(scene,null,2);const value=format==='json'&&json?json:source;const apply=()=>{try{const parsed=JSON.parse(json||source);onApply(parsed)}catch(e){alert(`JSON inválido: ${e.message}`)}};const copy=async()=>{await navigator.clipboard.writeText(value)};const download=()=>{const extension=format==='python'?'py':format==='tikz'?'tex':'json',blob=new Blob([value],{type:'text/plain;charset=utf-8'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=`diagrama-arnes.${extension}`;a.click();URL.revokeObjectURL(url)};return <div className="modal-backdrop code-panel-backdrop" onMouseDown={e=>e.target===e.currentTarget&&onClose()}><section className="diagram-code-panel"><header><div><div className="eyebrow">FUENTE DEL DIAGRAMA</div><h2>Código y dibujo sincronizados</h2><p>Exporta un origen editable en Python, TikZ o el JSON del lienzo.</p></div><button className="icon-button" onClick={onClose}><X size={17}/></button></header><nav className="code-tabs">{[['json','Especificación JSON'],['python','Python · SVG'],['tikz','LaTeX · TikZ']].map(([id,label])=><button key={id} className={format===id?'active':''} onClick={()=>{setFormat(id);setJson('')}}>{id==='python'?<Code size={14}/>:<FileText size={14}/>} {label}</button>)}</nav><textarea spellCheck="false" value={value} readOnly={format!=='json'} onChange={e=>setJson(e.target.value)} onFocus={e=>format==='json'&&!json&&setJson(source)}/><footer><span>JSON permite agregar elementos con componentId de library; Python y TikZ son exportaciones generadas.</span><div><button className="btn-quiet" onClick={copy}><Copy size={14}/> Copiar</button><button className="btn-quiet" onClick={download}><Download size={14}/> Descargar</button>{format==='json'&&<button className="btn-primary" onClick={apply}>Aplicar JSON al lienzo</button>}</div></footer></section></div>}
