import { useCallback, useEffect, useMemo, useState } from "react";

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

export function useVirtualList({
  items,
  itemHeight,
  overscan = 5,
  containerRef,
}) {
  const [range, setRange] = useState({ startIndex: 0, endIndex: -1 });

  const updateRange = useCallback(() => {
    const container = containerRef.current;
    const count = items.length;
    if (!container || count === 0 || itemHeight <= 0) {
      setRange({ startIndex: 0, endIndex: -1 });
      return;
    }
    const scrollTop = container.scrollTop || 0;
    const clientHeight = container.clientHeight || 0;
    const startIndex = clamp(
      Math.floor(scrollTop / itemHeight) - overscan,
      0,
      Math.max(0, count - 1),
    );
    const endIndex = clamp(
      Math.ceil((scrollTop + clientHeight) / itemHeight) + overscan,
      startIndex,
      Math.max(0, count - 1),
    );
    setRange((prev) =>
      prev.startIndex === startIndex && prev.endIndex === endIndex
        ? prev
        : { startIndex, endIndex },
    );
  }, [containerRef, itemHeight, items.length, overscan]);

  useEffect(() => {
    updateRange();
  }, [updateRange]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return undefined;
    let rafId = 0;
    const onScroll = () => {
      window.cancelAnimationFrame(rafId);
      rafId = window.requestAnimationFrame(updateRange);
    };
    container.addEventListener("scroll", onScroll, { passive: true });
    const observer =
      typeof ResizeObserver !== "undefined"
        ? new ResizeObserver(updateRange)
        : null;
    observer?.observe(container);
    return () => {
      window.cancelAnimationFrame(rafId);
      container.removeEventListener("scroll", onScroll);
      observer?.disconnect();
    };
  }, [containerRef, updateRange]);

  const totalHeight = items.length * itemHeight;
  const virtualItems = useMemo(() => {
    if (range.endIndex < range.startIndex) return [];
    return items
      .slice(range.startIndex, range.endIndex + 1)
      .map((item, offset) => {
        const index = range.startIndex + offset;
        return {
          item,
          index,
          style: {
            position: "absolute",
            top: index * itemHeight,
            height: itemHeight,
          },
        };
      });
  }, [itemHeight, items, range.endIndex, range.startIndex]);

  return {
    virtualItems,
    totalHeight,
    startIndex: range.startIndex,
    endIndex: range.endIndex,
  };
}
