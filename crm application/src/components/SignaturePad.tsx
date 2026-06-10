'use client';
import { useEffect, useRef, useState } from 'react';

/** Finger/mouse signature pad. Returns a PNG data-URL via onSign. */
export default function SignaturePad({ onSign, busy }: { onSign: (name: string, dataUrl: string) => void; busy: boolean }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [name, setName] = useState('');
  const [hasInk, setHasInk] = useState(false);
  const drawing = useRef(false);

  useEffect(() => {
    const canvas = canvasRef.current!;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = canvas.offsetWidth * dpr;
    canvas.height = 160 * dpr;
    const ctx = canvas.getContext('2d')!;
    ctx.scale(dpr, dpr);
    ctx.strokeStyle = '#1f2937';
    ctx.lineWidth = 2.5;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
  }, []);

  function pos(e: React.PointerEvent) {
    const rect = canvasRef.current!.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }

  function down(e: React.PointerEvent) {
    e.preventDefault();
    drawing.current = true;
    const ctx = canvasRef.current!.getContext('2d')!;
    const { x, y } = pos(e);
    ctx.beginPath();
    ctx.moveTo(x, y);
  }

  function move(e: React.PointerEvent) {
    if (!drawing.current) return;
    e.preventDefault();
    const ctx = canvasRef.current!.getContext('2d')!;
    const { x, y } = pos(e);
    ctx.lineTo(x, y);
    ctx.stroke();
    setHasInk(true);
  }

  function clear() {
    const canvas = canvasRef.current!;
    canvas.getContext('2d')!.clearRect(0, 0, canvas.width, canvas.height);
    setHasInk(false);
  }

  return (
    <div className="space-y-3">
      <input className="input" placeholder="Type your full name *" value={name} onChange={(e) => setName(e.target.value)} />
      <div className="rounded-lg border-2 border-dashed border-gray-300 bg-white">
        <canvas
          ref={canvasRef}
          className="h-40 w-full touch-none"
          onPointerDown={down}
          onPointerMove={move}
          onPointerUp={() => (drawing.current = false)}
          onPointerLeave={() => (drawing.current = false)}
        />
      </div>
      <p className="text-center text-xs text-gray-400">Sign above with your finger or mouse</p>
      <div className="flex gap-2">
        <button type="button" className="btn-ghost flex-1" onClick={clear}>Clear</button>
        <button
          type="button"
          className="btn-primary flex-1"
          disabled={busy || !name.trim() || !hasInk}
          onClick={() => onSign(name.trim(), canvasRef.current!.toDataURL('image/png'))}>
          {busy ? 'Submitting…' : 'Sign & accept'}
        </button>
      </div>
    </div>
  );
}
