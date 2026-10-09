import * as Dialog from '@radix-ui/react-dialog';
import { X, AlertTriangle } from 'lucide-react';
import type { ReactNode } from 'react';

export function Modal({ title, children, onClose, className = '' }: { title: string; children: ReactNode; onClose: () => void; className?: string }) {
  return <Dialog.Root open onOpenChange={open => !open && onClose()}><Dialog.Portal><Dialog.Overlay className="modal-overlay" /><Dialog.Content className={`modal ${className}`} aria-describedby={undefined}><div className="modal-heading"><Dialog.Title>{title}</Dialog.Title><Dialog.Close className="icon-button" aria-label="關閉視窗"><X size={21}/></Dialog.Close></div>{children}</Dialog.Content></Dialog.Portal></Dialog.Root>;
}
export function ConfirmDialog({ title, description, onConfirm, onClose, confirmLabel = '確認刪除' }: { title: string; description: string; onConfirm: () => void; onClose: () => void; confirmLabel?: string }) {
  return <Modal title={title} onClose={onClose} className="confirm-modal"><div className="confirm-icon"><AlertTriangle size={26}/></div><p className="muted">{description}</p><div className="modal-actions"><button className="button secondary" onClick={onClose}>取消</button><button className="button danger" onClick={() => { onConfirm(); onClose(); }}>{confirmLabel}</button></div></Modal>;
}
