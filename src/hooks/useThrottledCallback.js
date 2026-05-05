import { useCallback, useEffect, useRef } from "react";

export function useThrottledCallback(callback) {
  const callbackRef = useRef(callback);
  const frameRef = useRef(0);
  const argsRef = useRef(null);

  useEffect(() => {
    callbackRef.current = callback;
  }, [callback]);

  useEffect(
    () => () => {
      if (frameRef.current) cancelAnimationFrame(frameRef.current);
    },
    [],
  );

  return useCallback((...args) => {
    argsRef.current = args;
    if (frameRef.current) return;
    frameRef.current = requestAnimationFrame(() => {
      frameRef.current = 0;
      callbackRef.current(...(argsRef.current || []));
    });
  }, []);
}
