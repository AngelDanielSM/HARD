import { AlertTriangle, X } from 'lucide-react';
import { useEscape } from '../hooks/useEscape.js';

export default function ConfirmDialog({ title='Confirmar acción', message, confirmLabel='Eliminar', cancelLabel='Cancelar', busy=false, onConfirm, onCancel }) {
  useEscape(onCancel, true);
  return <div className="modal-backdrop app-confirm-backdrop" onMouseDown={event=>event.target===event.currentTarget&&onCancel()}>
    <section className="app-confirm-dialog" role="alertdialog" aria-modal="true" aria-labelledby="app-confirm-title">
      <div className="app-confirm-icon"><AlertTriangle size={19}/></div>
      <button className="icon-button app-confirm-close" aria-label="Cerrar" onClick={onCancel}><X size={16}/></button>
      <h2 id="app-confirm-title">{title}</h2>
      <p>{message}</p>
      <footer><button className="btn-quiet" disabled={busy} onClick={onCancel}>{cancelLabel}</button><button className="btn-danger" disabled={busy} onClick={onConfirm}>{busy?'Eliminando…':confirmLabel}</button></footer>
    </section>
  </div>;
}
