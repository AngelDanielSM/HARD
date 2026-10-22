import { useState } from 'react';
import { ChevronDown, Download, FileSpreadsheet, FileText, Printer, Share2 } from 'lucide-react';
import { useEscape } from '../hooks/useEscape.js';
import { downloadBomCsv, downloadHarnessData, downloadHarnessSvg } from './HarnessExport.jsx';

export default function ExportMenu({ nodes, edges, project, sheet, distribution = {}, onPrint }) {
  const [open, setOpen] = useState(false);
  useEscape(() => setOpen(false), open);
  const options = [
    ['pdf', <Printer size={14}/>, 'Vista previa / Guardar como PDF', onPrint],
    ['svg', <Share2 size={14}/>, 'Diagrama vectorial · SVG', () => downloadHarnessSvg({ nodes, edges, project, sheet })],
    ['bom', <FileSpreadsheet size={14}/>, 'Lista de materiales · CSV', () => downloadBomCsv({ nodes, edges, project })],
    ['json', <FileText size={14}/>, 'Escena editable · JSON', () => downloadHarnessData({ nodes, edges, project, sheet, distribution })],
  ];
  return <div className="export-menu"><button className="btn-primary export-button" aria-expanded={open} onClick={() => setOpen(value => !value)}><Download size={15}/> Exportar <ChevronDown size={13}/></button>{open && <div className="export-popover">{options.map(([id, icon, label, action]) => <button key={id} onClick={() => { action(); setOpen(false); }}><span>{icon}</span>{label}</button>)}<small><FileText size={12}/> PDF imprimible · SVG vectorial · CSV · JSON aplicable desde Código.</small></div>}</div>;
}
