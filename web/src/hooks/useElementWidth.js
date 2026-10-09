import { useEffect, useRef, useState } from 'react';

// Charts size themselves to their container, so they line up with the
// card they sit in at every screen width (the mobile charts' axis/
// alignment problems came from hard-coded widths).
export default function useElementWidth(fallback = 600) {
  const ref = useRef(null);
  const [width, setWidth] = useState(fallback);
  useEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    const ro = new ResizeObserver(([entry]) => {
      const w = Math.floor(entry.contentRect.width);
      if (w > 0) setWidth(w);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, width];
}
