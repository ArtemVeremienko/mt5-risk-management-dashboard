import { Component, createEffect, onMount } from 'solid-js';
import { getSymbolPriceBuffer } from '../../utils/sparklineBuffer';

interface Props {
  symbol: string;
  price: number;
  isPinned: boolean;
  isHovered: boolean;
  width?: number;
  height?: number;
}

export const MicroSparkline: Component<Props> = (props) => {
  let canvasRef: HTMLCanvasElement | undefined;
  const width = () => props.width ?? 64;
  const height = () => props.height ?? 20;

  const metrics = { min: 0, max: 0, first: 0, last: 0 };

  const draw = () => {
    if (!canvasRef) return;
    const ctx = canvasRef.getContext('2d');
    if (!ctx) return;

    const w = width();
    const h = height();
    const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;

    // Retina High-DPI Backing Store Calibration
    const targetW = Math.round(w * dpr);
    const targetH = Math.round(h * dpr);
    if (canvasRef.width !== targetW || canvasRef.height !== targetH) {
      canvasRef.width = targetW;
      canvasRef.height = targetH;
      canvasRef.style.width = `${w}px`;
      canvasRef.style.height = `${h}px`;
    }

    ctx.save();
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, w, h);

    const buffer = getSymbolPriceBuffer(props.symbol);

    if (!buffer.isReady()) {
      // Dormant placeholder baseline
      ctx.beginPath();
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.10)';
      ctx.lineWidth = 1;
      ctx.setLineDash([2, 2]);
      ctx.moveTo(0, h / 2);
      ctx.lineTo(w, h / 2);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.restore();
      return;
    }

    // Unroll into pre-allocated dual-buffer and extract metrics in a single O(N) pass
    const { data: renderArray, count } = buffer.getChronological(metrics);

    const padY = 2;
    const effH = h - padY * 2;
    const range = metrics.max - metrics.min;

    // Trend color determination
    const isUp = metrics.last > metrics.first;
    const isDown = metrics.last < metrics.first;
    
    // Read computed styling tokens from root, enabling CVD colorway reactivity
    const rootStyle = typeof window !== 'undefined' ? getComputedStyle(document.documentElement) : null;
    const profitToken = rootStyle?.getPropertyValue('--sys-color-profit').trim() || '#089981';
    const lossToken = rootStyle?.getPropertyValue('--sys-color-loss').trim() || '#f23645';

    const strokeColor = isUp
      ? profitToken
      : isDown
      ? lossToken
      : 'rgba(255, 255, 255, 0.40)';

    // Draw sparkline path
    ctx.beginPath();
    ctx.lineWidth = 1.35;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.strokeStyle = strokeColor;

    let lastX = 0;
    let lastY = h / 2;

    for (let i = 0; i < count; i++) {
      const x = count > 1 ? (i / (count - 1)) * w : 0;
      const price = renderArray[i];
      let y = h / 2;
      if (range > 0.000001) {
        y = padY + effH - ((price - metrics.min) / range) * effH;
      }

      if (i === 0) {
        ctx.moveTo(x, y);
      } else {
        ctx.lineTo(x, y);
      }

      if (i === count - 1) {
        lastX = x;
        lastY = y;
      }
    }
    ctx.stroke();

    // Pulsing live edge tick dot on newest point
    ctx.beginPath();
    ctx.arc(lastX, lastY, 2.0, 0, Math.PI * 2);
    ctx.fillStyle = strokeColor;
    ctx.fill();

    ctx.restore();
  };

  // Push incoming tick price into circular buffer
  createEffect(() => {
    const p = props.price;
    if (p > 0) {
      const buffer = getSymbolPriceBuffer(props.symbol);
      buffer.push(p);

      // Selective rendering budget: only repaint if pinned or hovered
      if (props.isPinned || props.isHovered) {
        draw();
      }
    }
  });

  // Catch up and repaint immediately when transitioning to pinned or hovered
  createEffect(() => {
    if (props.isPinned || props.isHovered) {
      draw();
    }
  });

  onMount(() => {
    draw();
  });

  return (
    <div
      class="micro-sparkline-container"
      title={`Sub-minute micro-tick trajectory (${props.symbol})`}
      style={{
        width: `${width()}px`,
        height: `${height()}px`,
        display: 'inline-flex',
        'align-items': 'center',
        'justify-content': 'center',
        opacity: props.isPinned || props.isHovered ? '1.0' : '0.45',
        transition: 'opacity 0.2s ease',
      }}
    >
      <canvas
        ref={canvasRef}
        width={width()}
        height={height()}
        class="micro-sparkline-canvas"
      />
    </div>
  );
};
