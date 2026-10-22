import { useEffect, useMemo, useState } from 'react';
import axios from 'axios';
import { Activity, AlertTriangle, Check, Download, FileText, Plus, Printer, Save, Trash2 } from 'lucide-react';

const api = axios.create({ baseURL: '/api' });
api.interceptors.request.use(config => {
  const token = localStorage.getItem('harness-token') || sessionStorage.getItem('harness-token') || '';
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

const testTypes = [
  'Continuidad punto a punto',
  'Circuito abierto / corto',
  'Resistencia de conductor',
  'Resistencia de aislamiento (IR)',
  'Rigidez dieléctrica (DWV / HiPot)',
  'Continuidad de blindaje',
  'Inspección visual y de crimps',
];
const reportsKey = 'harness-test-reports-v1';
const readReports = () => { try { return JSON.parse(localStorage.getItem(reportsKey) || '[]'); } catch { return []; } };
const pinEndpoint = (raw, nodes, splices) => {
  const [nodeId, pin] = String(raw || '').split(':');
  const node = nodes.find(item => String(item.id) === nodeId);
  const splice = splices.find(item => `splice-${item.id}` === nodeId);
  if (node) return `${node.componente_nombre || node.nombre || node.label || `Conector ${nodeId}`} · Pin ${pin || '—'}${node.pinout?.[Number(pin) - 1] ? ` (${node.pinout[Number(pin) - 1]})` : ''}`;
  if (splice) return `${splice.nombre || 'Crimp'} · Vía ${pin || '—'}`;
  return `${nodeId || 'Punto'} · ${pin || '—'}`;
};
const newRow = (n=1) => ({ id: `${Date.now()}-${n}-${Math.random().toString(16).slice(2,6)}`, circuito: `Punto ${n}`, origen: '', destino: '', limite: '', medido: '', resultado: 'Pendiente', observaciones: '' });
const stamp = value => value ? new Date(value).toLocaleString('es-MX') : '—';

export default function HarnessTestReports({ projects, user }) {
  const [projectId, setProjectId] = useState('');
  const [projectData, setProjectData] = useState(null);
  const [loadingProject, setLoadingProject] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [savedReports, setSavedReports] = useState(readReports);
  const [reportId, setReportId] = useState('');
  const [form, setForm] = useState({ type: testTypes[0], serial: '', revision: '', operator: user?.nombre || '', instrument: '', instrumentId: '', calibrationDate: '', procedure: '', parameters: '', notes: '' });
  const [rows, setRows] = useState([]);
  const [message, setMessage] = useState('');
  const selectedProject = projects.find(project => String(project.id) === String(projectId));
  const testsComplete = rows.length > 0 && rows.every(row => row.resultado !== 'Pendiente');
  const summary = useMemo(() => rows.reduce((acc, row) => { acc[row.resultado] = (acc[row.resultado] || 0) + 1; return acc; }, {}), [rows]);

  useEffect(() => {
    if (!projectId) { setProjectData(null); setRows([]); return; }
    let cancelled = false;
    setLoadingProject(true); setLoadError('');
    api.get(`/proyectos/${projectId}`).then(({ data }) => {
      if (cancelled) return;
      setProjectData(data);
      const nodes = data.nodes || [];
      const wires = data.cables || [];
      const splices = data.empalmes || [];
      const initial = wires.map((wire, index) => ({
        ...newRow(index + 1),
        circuito: wire.etiqueta || `Circuito ${index + 1}`,
        origen: pinEndpoint(wire.pin_origen_id, nodes, splices),
        destino: pinEndpoint(wire.pin_destino_id, nodes, splices),
        limite: '', medido: '', resultado: 'Pendiente',
        observaciones: `${wire.calibre || 'Calibre —'} · ${wire.color || 'Color —'}${wire.longitud_mm ? ` · ${wire.longitud_mm} mm` : ''}`,
      }));
      if (!reportId) setRows(initial.length ? initial : [newRow(1)]);
    }).catch(error => { if (!cancelled) { setProjectData(null); setLoadError(error.response?.data?.error || 'No se pudo leer el diagrama de este arnés.'); if (!reportId) setRows([newRow(1)]); } })
      .finally(() => { if (!cancelled) setLoadingProject(false); });
    return () => { cancelled = true; };
  }, [projectId, reportId]);

  const updateForm = (key, value) => setForm(current => ({ ...current, [key]: value }));
  const updateRow = (id, key, value) => setRows(current => current.map(row => row.id === id ? { ...row, [key]: value } : row));
  const saveReport = () => {
    if (!selectedProject || !form.type || !form.operator.trim()) return;
    const id = reportId || `HL-TEST-${new Date().toISOString().replaceAll('-', '').replaceAll(':', '').replaceAll('T', '').replaceAll('Z', '').replaceAll('.', '').slice(0, 14)}`;
    const report = { id, projectId: selectedProject.id, projectName: selectedProject.nombre, projectRevision: form.revision || projectData?.revision || '—', serial: form.serial, type: form.type, operator: form.operator, instrument: form.instrument, instrumentId: form.instrumentId, calibrationDate: form.calibrationDate, procedure: form.procedure, parameters: form.parameters, notes: form.notes, rows, updatedAt: new Date().toISOString(), createdAt: reportId ? savedReports.find(item => item.id === reportId)?.createdAt || new Date().toISOString() : new Date().toISOString(), verdict: rows.some(row => row.resultado === 'No conforme') ? 'No conforme' : testsComplete ? 'Conforme' : 'Pendiente' };
    const next = [report, ...savedReports.filter(item => item.id !== id)];
    localStorage.setItem(reportsKey, JSON.stringify(next)); setSavedReports(next); setReportId(id); setMessage('Reporte guardado en este dispositivo.');
  };
  const startNew = () => { setReportId(''); setForm({ type: testTypes[0], serial: '', revision: '', operator: user?.nombre || '', instrument: '', instrumentId: '', calibrationDate: '', procedure: '', parameters: '', notes: '' }); setProjectId(''); setProjectData(null); setRows([]); setMessage(''); };
  const openReport = report => {
    setReportId(report.id); setProjectId(String(report.projectId)); setForm({ type: report.type, serial: report.serial || '', revision: report.projectRevision || '', operator: report.operator || '', instrument: report.instrument || '', instrumentId: report.instrumentId || '', calibrationDate: report.calibrationDate || '', procedure: report.procedure || '', parameters: report.parameters || '', notes: report.notes || '' });
    setRows(report.rows || []); setMessage('Reporte cargado. Guarda los cambios antes de imprimir.');
  };
  const removeReport = id => { const next = savedReports.filter(item => item.id !== id); localStorage.setItem(reportsKey, JSON.stringify(next)); setSavedReports(next); if (reportId === id) startNew(); };
  const exportCsv = () => {
    const quote = value => `"${String(value ?? '').replaceAll('"', '""')}"`;
    const content = [['Circuito','Origen','Destino','Límite de aceptación','Medición','Resultado','Observaciones'], ...rows.map(row => [row.circuito,row.origen,row.destino,row.limite,row.medido,row.resultado,row.observaciones])].map(line => line.map(quote).join(',')).join('\r\n');
    const blob = new Blob(['\ufeff' + content], { type: 'text/csv;charset=utf-8' }); const url = URL.createObjectURL(blob); const anchor = document.createElement('a'); anchor.href = url; anchor.download = `${reportId || 'reporte-pruebas'}-resultados.csv`; anchor.click(); URL.revokeObjectURL(url);
  };

  return <main className="workspace-main test-reports-page">
    <div className="workspace-welcome"><div><div className="eyebrow">CALIDAD · REGISTRO DE ENSAYOS</div><h1>Reportes de pruebas</h1><p>Documenta continuidad, aislamiento, resistencia e inspecciones por arnés.</p></div><button className="btn-quiet" onClick={startNew}><Plus size={15}/> Nuevo reporte</button></div>
    <div className="report-safety-note"><AlertTriangle size={17}/><span><strong>Pruebas eléctricas controladas.</strong> Registra los límites y parámetros de la especificación aprobada. Este formulario no prescribe voltajes ni sustituye el procedimiento del equipo; IR y DWV/HiPot pueden ser peligrosas o dañar componentes electrónicos.</span></div>
    <div className="test-report-layout">
      <section className="test-report-editor">
        <div className="report-section-heading"><span>01</span><div><strong>Identificación del ensayo</strong><small>Proyecto, muestra, procedimiento y equipo empleado</small></div></div>
        <div className="report-form-grid">
          <label>Arnés / proyecto<select value={projectId} onChange={event => { setProjectId(event.target.value); setReportId(''); setMessage(''); }}><option value="">Selecciona un arnés…</option>{projects.map(project => <option key={project.id} value={project.id}>{project.nombre}</option>)}</select></label>
          <label>Tipo de prueba<select value={form.type} onChange={event => updateForm('type', event.target.value)}>{testTypes.map(type => <option key={type}>{type}</option>)}</select></label>
          <label>Número de serie / lote<input value={form.serial} onChange={event => updateForm('serial', event.target.value)} placeholder="S/N, lote o prototipo"/></label>
          <label>Revisión del arnés<input value={form.revision} onChange={event => updateForm('revision', event.target.value)} placeholder="Ej. Rev A"/></label>
          <label>Operador / inspector<input required value={form.operator} onChange={event => updateForm('operator', event.target.value)} placeholder="Nombre responsable"/></label>
          <label>Procedimiento / plano<input value={form.procedure} onChange={event => updateForm('procedure', event.target.value)} placeholder="Documento y revisión aplicable"/></label>
          <label>Equipo de prueba<input value={form.instrument} onChange={event => updateForm('instrument', event.target.value)} placeholder="Fabricante y modelo"/></label>
          <label>Identificación del equipo<input value={form.instrumentId} onChange={event => updateForm('instrumentId', event.target.value)} placeholder="No. de serie / activo"/></label>
          <label>Calibración vigente hasta<input type="date" value={form.calibrationDate} onChange={event => updateForm('calibrationDate', event.target.value)}/></label>
          <label className="report-full-field">Parámetros / condiciones de prueba<textarea rows="2" value={form.parameters} onChange={event => updateForm('parameters', event.target.value)} placeholder="Transcribe los valores de la especificación aprobada: límite, tensión, duración, temperatura, etc. No se proponen valores por defecto."/></label>
        </div>
        {loadError&&<p className="form-error">{loadError}</p>}
        {loadingProject&&<p className="report-loading"><Activity size={14}/> Cargando conexiones del arnés…</p>}
        <div className="report-section-heading report-results-heading"><span>02</span><div><strong>Resultados por circuito / punto</strong><small>Los circuitos del diagrama se importan como puntos de verificación editables.</small></div><button className="btn-quiet" onClick={()=>setRows(current=>[...current,newRow(current.length+1)])}><Plus size={14}/> Añadir punto</button></div>
        <div className="report-table-wrap"><table className="test-results-table"><thead><tr><th>Circuito / punto</th><th>Origen</th><th>Destino</th><th>Límite / criterio</th><th>Medición</th><th>Resultado</th><th>Observaciones</th><th/></tr></thead><tbody>{rows.map(row=><tr key={row.id}><td><input aria-label="Circuito o punto" value={row.circuito} onChange={event=>updateRow(row.id,'circuito',event.target.value)}/></td><td><input aria-label="Origen" value={row.origen} onChange={event=>updateRow(row.id,'origen',event.target.value)}/></td><td><input aria-label="Destino" value={row.destino} onChange={event=>updateRow(row.id,'destino',event.target.value)}/></td><td><input aria-label="Límite de aceptación" value={row.limite} onChange={event=>updateRow(row.id,'limite',event.target.value)} placeholder="Según plano"/></td><td><input aria-label="Medición" value={row.medido} onChange={event=>updateRow(row.id,'medido',event.target.value)} placeholder="Valor y unidad"/></td><td><select aria-label="Resultado" value={row.resultado} onChange={event=>updateRow(row.id,'resultado',event.target.value)}><option>Pendiente</option><option>Conforme</option><option>No conforme</option><option>No aplica</option></select></td><td><input aria-label="Observaciones" value={row.observaciones} onChange={event=>updateRow(row.id,'observaciones',event.target.value)} placeholder="Notas"/></td><td><button className="icon-button danger-icon" title="Quitar punto" aria-label="Quitar punto" onClick={()=>setRows(current=>current.filter(item=>item.id!==row.id))}><Trash2 size={14}/></button></td></tr>)}</tbody></table>{!rows.length&&<p className="catalog-empty">Selecciona un arnés para cargar sus conexiones o agrega un punto manual.</p>}</div>
        <label className="report-notes-label">Conclusión / observaciones del reporte<textarea rows="3" value={form.notes} onChange={event=>updateForm('notes',event.target.value)} placeholder="Hallazgos, desviaciones, acciones o comentarios…"/></label>
        <div className="report-actions"><span>{message}{reportId&&<small> · {reportId}</small>}</span><div><button className="btn-quiet" onClick={exportCsv} disabled={!rows.length}><Download size={14}/> CSV</button><button className="btn-quiet" onClick={saveReport} disabled={!projectId||!form.operator.trim()}><Save size={14}/> Guardar reporte</button><button className="btn-primary" onClick={()=>{saveReport();window.setTimeout(()=>window.print(),50)}} disabled={!projectId||!form.operator.trim()}><Printer size={14}/> Imprimir / PDF</button></div></div>
      </section>
      <aside className="test-report-sidebar"><section className="report-summary-card"><div className="eyebrow">ESTADO DEL REPORTE</div><strong className={`report-verdict ${summary['No conforme']?'verdict-fail':testsComplete?'verdict-pass':''}`}>{summary['No conforme']?'No conforme':testsComplete?'Revisado':'Pendiente'}</strong><div><span>{rows.length} puntos</span><span>{summary['Conforme']||0} conformes</span><span>{summary['No conforme']||0} no conformes</span><span>{summary['Pendiente']||0} pendientes</span></div></section><section className="report-types-card"><div className="eyebrow">PRUEBAS DOCUMENTABLES</div>{testTypes.map(type=><button key={type} className={form.type===type?'selected':''} onClick={()=>updateForm('type',type)}><FileText size={13}/>{type}</button>)}</section><section className="report-references-card"><small>El formato contempla identificación, parámetros, valores medidos y dictamen, elementos presentes en reportes de ensayo de arneses.</small><a href="https://qaexternal.jpl.nasa.gov/qcprint.php?clause=QC134" target="_blank" rel="noreferrer">Ver ejemplo de requisitos de reporte de JPL</a><a href="https://www.ipc.org/news-release/ipc-releases-ipcwhma-620e-requirements-and-acceptance-cable-and-wire-harness" target="_blank" rel="noreferrer">IPC/WHMA-A-620 · fabricación y aceptación</a></section></aside>
    </div>
    <section className="saved-test-reports"><div className="report-section-heading"><span>03</span><div><strong>Reportes guardados</strong><small>Se conservan localmente en este navegador.</small></div><span className="report-count">{savedReports.length}</span></div>{savedReports.length?<div className="saved-report-list">{savedReports.map(report=><article key={report.id}><FileText size={17}/><div><strong>{report.projectName} · {report.type}</strong><small>{report.id} · {report.serial||'Sin número de serie'} · {stamp(report.updatedAt)}</small></div><span className={`report-list-verdict ${report.verdict==='Conforme'?'verdict-pass':report.verdict==='No conforme'?'verdict-fail':''}`}>{report.verdict}</span><button className="btn-quiet" onClick={()=>openReport(report)}>Abrir</button><button className="icon-button danger-icon" title="Eliminar reporte" onClick={()=>removeReport(report.id)}><Trash2 size={14}/></button></article>)}</div>:<p className="catalog-empty">Aún no hay reportes guardados.</p>}</section>
    <article className="test-report-print-sheet"><header><div><span>HARNESSLAB · REPORTE DE PRUEBA</span><h1>{form.type}</h1><p>{selectedProject?.nombre||'Sin proyecto'} · {reportId||'BORRADOR'}</p></div><b>{rows.some(row=>row.resultado==='No conforme')?'NO CONFORME':testsComplete?'CONFORME':'PENDIENTE'}</b></header><div className="test-report-print-meta"><span><small>Número de serie</small>{form.serial||'—'}</span><span><small>Revisión</small>{form.revision||'—'}</span><span><small>Operador</small>{form.operator||'—'}</span><span><small>Procedimiento / plano</small>{form.procedure||'—'}</span><span><small>Equipo</small>{[form.instrument,form.instrumentId].filter(Boolean).join(' · ')||'—'}</span><span><small>Calibración</small>{form.calibrationDate||'—'}</span><span><small>Parámetros</small>{form.parameters||'Según procedimiento aprobado'}</span></div><table><thead><tr><th>Circuito</th><th>Origen</th><th>Destino</th><th>Criterio</th><th>Medición</th><th>Resultado</th><th>Observaciones</th></tr></thead><tbody>{rows.map(row=><tr key={row.id}><td>{row.circuito}</td><td>{row.origen}</td><td>{row.destino}</td><td>{row.limite||'—'}</td><td>{row.medido||'—'}</td><td>{row.resultado}</td><td>{row.observaciones||'—'}</td></tr>)}</tbody></table><div className="test-report-print-notes"><strong>Conclusión / observaciones</strong><p>{form.notes||'—'}</p></div><footer><span>Generado {stamp(new Date().toISOString())}</span><span>Firma del inspector: ______________________________</span></footer></article>
  </main>;
}
