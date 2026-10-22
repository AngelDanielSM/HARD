import { useEffect, useRef } from 'react';

export function useEscape(onEscape, active = true) {
  const callback = useRef(onEscape);
  callback.current = onEscape;
  useEffect(() => {
    if (!active) return undefined;
    const handle = event => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      callback.current?.(event);
    };
    window.addEventListener('keydown', handle, true);
    return () => window.removeEventListener('keydown', handle, true);
  }, [active]);
}
