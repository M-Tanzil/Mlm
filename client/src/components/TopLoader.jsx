import { useEffect, useRef, useState } from 'react';
import { useSelector } from 'react-redux';

export default function TopLoader() {
  const pending = useSelector((s) => s.loading.pending);
  const [width, setWidth] = useState(0);
  const [visible, setVisible] = useState(false);
  const tick = useRef(null);
  const hide = useRef(null);

  useEffect(() => {
    clearInterval(tick.current);
    clearTimeout(hide.current);
    if (pending > 0) {
      setVisible(true);
      setWidth((w) => (w > 0 && w < 100 ? w : 8));
      tick.current = setInterval(() => setWidth((w) => w + (90 - w) * 0.12), 250);
    } else {
      setWidth(100);
      hide.current = setTimeout(() => { setVisible(false); setWidth(0); }, 350);
    }
    return () => { clearInterval(tick.current); clearTimeout(hide.current); };
  }, [pending]);

  return (
    <>
      <div
        aria-hidden="true"
        className="fixed top-0 left-0 z-50 h-[3px] bg-indigo-600 shadow-[0_0_8px_rgba(79,70,229,0.6)]"
        style={{ width: `${width}%`, opacity: visible ? 1 : 0, transition: 'width 250ms ease-out, opacity 300ms ease' }}
      />
      <div role="status" className="sr-only">{pending > 0 ? 'Loading' : ''}</div>
    </>
  );
}