import { useEffect } from 'react';
import { Dashboard } from './components/Dashboard';
import { useFleetStore } from './store/useFleetStore';

export default function App() {
  const connectWebSocket = useFleetStore((state) => state.connectWebSocket);

  useEffect(() => {
    // Connect to WebSocket feed from FastAPI backend via Vite proxy or same-host
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}/ws/fleet`;
    connectWebSocket(wsUrl);
  }, [connectWebSocket]);

  return <Dashboard />;
}
