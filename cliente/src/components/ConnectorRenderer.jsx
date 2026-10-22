import { useMemo, useRef, useState } from 'react';
import { Check, X } from 'lucide-react';
import { useEscape } from '../hooks/useEscape.js';

// Dibuja un conector circular como SVG; las posiciones dependen solo del número de contactos.
function posicionesPines(cantidad,familia,genero) {
  if(familia==='RJ45')return Array.from({length:cantidad},(_,i)=>({id:i+1,x:248+i*(144/Math.max(cantidad-1,1)),y:i%2?246:274,angle:i%2?Math.PI/2:-Math.PI/2}));
  if(familia==='JST')return Array.from({length:cantidad},(_,i)=>{const cols=Math.ceil(cantidad/2),row=Math.floor(i/cols),col=i%cols;return{id:i+1,x:320+(col-(cols-1)/2)*25,y:row===0?238:282,angle:row?Math.PI/2:-Math.PI/2};});
  if(familia==='JR')return Array.from({length:cantidad},(_,i)=>{const angle=(-90+i*360/cantidad)*Math.PI/180;return{id:i+1,x:320+Math.cos(angle)*67,y:260+Math.sin(angle)*67,angle};});
  const anillos = cantidad <= 8 ? [{n:cantidad,r:62,offset:-90}] : cantidad <= 16
    ? [{n:6,r:36,offset:-90},{n:cantidad-6,r:76,offset:-90}]
    : [{n:5,r:34,offset:-90},{n:7,r:68,offset:-90},{n:cantidad-12,r:99,offset:-90}];
  let index=0;
  const pins=anillos.flatMap(anillo=>Array.from({length:anillo.n},(_,i)=>{
    const angle=(anillo.offset+i*360/anillo.n)*Math.PI/180;
    return {id:++index,x:320+Math.cos(angle)*anillo.r,y:260+Math.sin(angle)*anillo.r,angle};
  }));
  const orientados=genero==='Macho'?pins.map(pin=>({...pin,x:640-pin.x})):pins;
  return orientados.sort((a,b)=>a.y-b.y||a.x-b.x).map((pin,index)=>({...pin,id:index+1}));
}

export default function ConnectorRenderer({pinCount=5,labels={},colors={},onChangeLabel,onChangeColor,readOnly=false,familia='Circular',genero='Hembra',positions={},onChangePosition,onSelectPosition,precision=false,compact=false}) {
  const [editing,setEditing]=useState(null);
  const [draft,setDraft]=useState('');
  const [draftColor,setDraftColor]=useState('#b7c4ca');
  const [dragging,setDragging]=useState(null);
  const movedRef=useRef(false);
  useEscape(()=>setEditing(null),editing!==null);
  const svgRef=useRef(null);
  const pins=useMemo(()=>posicionesPines(pinCount,familia,genero).map(pin=>({...pin,...(positions[pin.id]||{})})),[pinCount,familia,genero,positions]);
  const leaders=useMemo(()=>{
    const sides={left:[],right:[]};
    pins.forEach(pin=>sides[pin.x<320?'left':'right'].push(pin));
    // Ordenar por altura y repartir filas: evita que los textos se amontonen con muchos pines.
    for(const side of Object.keys(sides)) sides[side].sort((a,b)=>a.y-b.y).forEach((pin,i)=>{
      const total=sides[side].length;
      pin.labelY=total===1?260:40+i*(440/(total-1));
      pin.side=side;
    });
    return pins.filter(pin=>labels[pin.id]?.trim()).map(pin=>{
      const side=pin.side;
      const ux=(pin.x-320)/Math.hypot(pin.x-320,pin.y-260);
      const uy=(pin.y-260)/Math.hypot(pin.x-320,pin.y-260);
      const outerX=320+ux*132,outerY=260+uy*132;
      const railX=side==='right'?462:178;
      const textX=side==='right'?470:170;
      const anchor=side==='right'?'start':'end';
      const path=`M ${pin.x} ${pin.y} L ${outerX} ${outerY} L ${railX} ${outerY} L ${railX} ${pin.labelY} L ${textX} ${pin.labelY}`;
      return {...pin,path,textX,anchor};
    });
  },[pins,labels]);

  const openPin=pin=>{if(readOnly)return;setEditing(pin.id);setDraft(labels[pin.id]||'');setDraftColor(colors[pin.id]||'#b7c4ca');};
  const save=event=>{event.preventDefault();onChangeLabel?.(editing,draft.trim());onChangeColor?.(editing,draftColor);setEditing(null);};
  const movePointer=event=>{if(dragging===null||!svgRef.current)return;const point=svgRef.current.createSVGPoint();point.x=event.clientX;point.y=event.clientY;const local=point.matrixTransform(svgRef.current.getScreenCTM().inverse());const dx=local.x-320,dy=local.y-260,length=Math.hypot(dx,dy),limit=familia==='Circular'?96:105,scale=length>limit?limit/length:1,step=precision?1:5;if(length>3)movedRef.current=true;onChangePosition?.(dragging,{x:Math.round((320+dx*scale)/step)*step,y:Math.round((260+dy*scale)/step)*step});};
  const finishDrag=()=>setDragging(null);

  return <div className="connector-renderer">
    <svg ref={svgRef} className={`connector-svg gender-${genero.toLowerCase()}`} viewBox={compact?"160 100 320 320":"0 0 640 540"} role="img" aria-label={`Vista frontal del conector, ${pinCount} pines`} onPointerMove={movePointer} onPointerUp={finishDrag} onPointerCancel={finishDrag}>
      <defs><radialGradient id="shellFill"><stop offset="72%" stopColor="#25303a"/><stop offset="73%" stopColor="#121a21"/></radialGradient><filter id="pinGlow"><feGaussianBlur stdDeviation="2" result="blur"/><feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge></filter></defs>
      {familia==='Circular'?<><circle cx="320" cy="260" r="139" fill="#141b21" stroke="#64717b" strokeWidth="3"/><circle cx="320" cy="260" r="132" fill="none" stroke="#aab3b9" strokeWidth="3"/><circle cx="320" cy="260" r="124" fill="none" stroke="#414d56" strokeWidth="4"/><circle cx="320" cy="260" r="116" fill="#303941" stroke="#9aa4aa" strokeWidth="2"/><circle cx="320" cy="260" r="105" fill="url(#shellFill)" stroke="#05090d" strokeWidth="2"/><path d="M306 155h28v10h-28z" fill="#8f9aa1" stroke="#0a0e12" strokeWidth="2"/></>:<g className="rectangular-housing"><rect x="220" y="163" width="200" height="194" rx={familia==='RJ45'?12:22} fill="#252f37" stroke="#98a3aa" strokeWidth="4"/><rect x="232" y="175" width="176" height="170" rx={familia==='RJ45'?8:17} fill="#141c22" stroke="#59666e" strokeWidth="3"/>{familia==='RJ45'&&<path d="M270 163v-18h100v18M292 344h56v16h-56z" fill="#303a42" stroke="#7f8a91" strokeWidth="2"/>}</g>}
      {leaders.map(pin=><g key={`leader-${pin.id}`} className="pin-leader"><path d={pin.path}/><circle cx={pin.textX} cy={pin.labelY} r="3"/><text x={pin.textX+(pin.side==='right'?8:-8)} y={pin.labelY+4} textAnchor={pin.anchor}><title>{`PIN ${pin.id}: ${labels[pin.id]}`}</title>{`PIN ${pin.id}: ${labels[pin.id].length>25?`${labels[pin.id].slice(0,24)}…`:labels[pin.id]}`}</text></g>)}
      {pins.map(pin=><g key={pin.id} className={`connector-pin ${labels[pin.id]?'pin-labeled':''} ${dragging===pin.id?'is-dragging':''}`} onClick={()=>{if(movedRef.current){movedRef.current=false;return;}openPin(pin)}} onPointerDown={e=>{if(!readOnly){movedRef.current=false;onSelectPosition?.({id:pin.id,x:pin.x,y:pin.y});e.preventDefault();e.stopPropagation();setDragging(pin.id);e.currentTarget.setPointerCapture?.(e.pointerId)}}} onKeyDown={e=>e.key==='Enter'&&openPin(pin)} tabIndex={readOnly?-1:0} role="button" aria-label={`Pin ${pin.id}${labels[pin.id]?`: ${labels[pin.id]}`:''}`}>
        <text x={familia==='Circular'||familia==='JR'?pin.x-((pin.y-260)/Math.hypot(pin.x-320,pin.y-260))*17:pin.x} y={familia==='Circular'||familia==='JR'?pin.y+((pin.x-320)/Math.hypot(pin.x-320,pin.y-260))*17+4:pin.y-14} textAnchor="middle" className="pin-index">{pin.id}</text><circle cx={pin.x} cy={pin.y} r="10" className="pin-socket"/><circle cx={pin.x} cy={pin.y} r="5" className="pin-contact" style={{fill:colors[pin.id]||undefined}}/><circle cx={pin.x} cy={pin.y} r="2" className="pin-center"/>
      </g>)}
    </svg>
    {!readOnly&&editing!==null&&<div className="pin-label-popover-backdrop" onMouseDown={e=>e.target===e.currentTarget&&setEditing(null)}><form className="pin-label-popover" onSubmit={save}><div className="popover-title"><div><span>ETIQUETA DE CONTACTO</span><strong>Pin {editing}</strong></div><button type="button" className="icon-button" onClick={()=>setEditing(null)}><X size={16}/></button></div><label htmlFor="pin-label-input">Nombre de etiqueta</label><input id="pin-label-input" autoFocus maxLength={80} value={draft} onChange={e=>setDraft(e.target.value)} placeholder="Ej. +24V POWER"/><label htmlFor="pin-label-color">Color del contacto</label><div className="pin-color-input"><input id="pin-label-color" type="color" value={draftColor} onChange={e=>setDraftColor(e.target.value)}/><span>{draftColor.toUpperCase()}</span></div><div className="popover-actions"><button type="button" className="btn-quiet" onClick={()=>{onChangeLabel?.(editing,'');onChangeColor?.(editing,'#b7c4ca');setEditing(null)}}>Limpiar</button><button className="btn-primary" type="submit"><Check size={15}/> Guardar</button></div></form></div>}
  </div>;
}
