import { useEffect, useState } from 'react';

// rAF-throttled, not a raw resize-event callback — resize fires on every intermediate pixel
// during an active window drag or orientation change, and callers of this (currently: the atom
// stage's own label-length responsiveness) only need the settled final width, not a repaint per
// pixel.
export function useViewportWidth() {
  const [width, setWidth] = useState(() =>
    typeof window !== 'undefined' ? window.innerWidth : 1280,
  );

  useEffect(() => {
    if (typeof window === 'undefined') {
      return undefined;
    }

    let frame = null;
    const handleResize = () => {
      if (frame != null) {
        return;
      }
      frame = requestAnimationFrame(() => {
        frame = null;
        setWidth(window.innerWidth);
      });
    };

    window.addEventListener('resize', handleResize);
    return () => {
      window.removeEventListener('resize', handleResize);
      if (frame != null) {
        cancelAnimationFrame(frame);
      }
    };
  }, []);

  return width;
}
