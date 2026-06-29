import { useState, useEffect, useRef } from 'react';
import { WS_URL } from '../config/api';

const RECONNECT_DELAY_MS = 5000;

const useWaterLevelWS = () => {
  const [latestReading, setLatestReading] = useState(null);
  const [isConnected, setIsConnected] = useState(false);
  const wsRef = useRef(null);
  const reconnectTimerRef = useRef(null);
  const unmountedRef = useRef(false);

  useEffect(() => {
    unmountedRef.current = false;

    const connect = () => {
      if (unmountedRef.current) return;

      const ws = new WebSocket(WS_URL);
      wsRef.current = ws;

      ws.onopen = () => {
        if (!unmountedRef.current) setIsConnected(true);
      };

      ws.onclose = () => {
        if (unmountedRef.current) return;
        setIsConnected(false);
        reconnectTimerRef.current = setTimeout(connect, RECONNECT_DELAY_MS);
      };

      ws.onerror = () => ws.close();

      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          if (msg.type === 'new_reading' && !unmountedRef.current) {
            setLatestReading(msg.data);
          }
        } catch (_) {}
      };
    };

    connect();

    return () => {
      unmountedRef.current = true;
      clearTimeout(reconnectTimerRef.current);
      wsRef.current?.close();
    };
  }, []);

  return { latestReading, isConnected };
};

export default useWaterLevelWS;
