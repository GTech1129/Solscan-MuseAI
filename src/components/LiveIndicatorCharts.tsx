import React, { useRef, useEffect, useState, useMemo } from 'react';

export interface CandleChartBar {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  tenkan: number | null;
  vwma: number | null;
  sma50: number | null;
  cci: number | null;
  fisher: number | null;
  fisherSignal: number | null;
  atr: number | null;
}

interface LiveIndicatorChartsProps {
  candles: CandleChartBar[];
  currentAsset: string;
  timeframe?: string;
  onTimeframeChange?: (tf: string) => void;
}

const TIMEFRAMES = [
  { id: '1m', label: '1m' },
  { id: '3m', label: '3m' },
  { id: '5m', label: '5m' },
  { id: '15m', label: '15m' },
  { id: '30m', label: '30m' },
  { id: '1h', label: '1h' },
  { id: '4h', label: '4h' },
  { id: '1d', label: '1D' },
];

export const LiveIndicatorCharts: React.FC<LiveIndicatorChartsProps> = ({
  candles,
  currentAsset,
  timeframe = '15m',
  onTimeframeChange,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [containerWidth, setContainerWidth] = useState<number>(900);
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);

  const priceCanvasRef = useRef<HTMLCanvasElement>(null);
  const cciCanvasRef = useRef<HTMLCanvasElement>(null);
  const fishCanvasRef = useRef<HTMLCanvasElement>(null);
  const atrCanvasRef = useRef<HTMLCanvasElement>(null);

  // ResizeObserver for responsive canvas sizing
  useEffect(() => {
    if (!containerRef.current) return;
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        if (entry.contentRect.width > 0) {
          setContainerWidth(Math.floor(entry.contentRect.width));
        }
      }
    });
    observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, []);

  // Display the last 60 to 75 bars to match the visual aspect ratio in the screenshot
  const displayBars = useMemo(() => {
    if (!candles || candles.length === 0) return [];
    const count = Math.min(candles.length, 65);
    return candles.slice(-count);
  }, [candles]);

  const numBars = displayBars.length;

  // Chart layout dimensions
  const paddingLeft = 55; // For Y-axis labels
  const paddingRight = 15;
  const chartWidth = Math.max(200, containerWidth - paddingLeft - paddingRight);
  const barSpacing = numBars > 1 ? chartWidth / (numBars - 1) : chartWidth;
  const candleBodyWidth = Math.max(3, Math.min(10, barSpacing * 0.65));

  // --- DRAW PRICE CANDLESTICK CHART ---
  useEffect(() => {
    const canvas = priceCanvasRef.current;
    if (!canvas || numBars === 0) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const height = 280;
    canvas.width = containerWidth * dpr;
    canvas.height = height * dpr;
    canvas.style.width = `${containerWidth}px`;
    canvas.style.height = `${height}px`;

    ctx.save();
    ctx.scale(dpr, dpr);

    // Dark background
    ctx.fillStyle = '#111110';
    ctx.fillRect(0, 0, containerWidth, height);

    // Calculate Y scale for Price
    let minPrice = Infinity;
    let maxPrice = -Infinity;
    displayBars.forEach((b) => {
      if (b.low < minPrice) minPrice = b.low;
      if (b.high > maxPrice) maxPrice = b.high;
      if (b.tenkan != null) {
        if (b.tenkan < minPrice) minPrice = b.tenkan;
        if (b.tenkan > maxPrice) maxPrice = b.tenkan;
      }
      if (b.vwma != null) {
        if (b.vwma < minPrice) minPrice = b.vwma;
        if (b.vwma > maxPrice) maxPrice = b.vwma;
      }
      if (b.sma50 != null) {
        if (b.sma50 < minPrice) minPrice = b.sma50;
        if (b.sma50 > maxPrice) maxPrice = b.sma50;
      }
    });

    if (!isFinite(minPrice) || !isFinite(maxPrice) || minPrice === maxPrice) {
      minPrice = 115;
      maxPrice = 125;
    }

    // Add 8% margin top and bottom
    const pMargin = (maxPrice - minPrice) * 0.08 || 1;
    minPrice -= pMargin;
    maxPrice += pMargin;
    const pRange = maxPrice - minPrice;

    const chartTop = 15;
    const chartBottom = height - 25;
    const plotHeight = chartBottom - chartTop;

    const getPriceY = (val: number) => {
      return chartBottom - ((val - minPrice) / pRange) * plotHeight;
    };

    const getBarX = (idx: number) => {
      return paddingLeft + idx * barSpacing;
    };

    // Horizontal grid lines & Y labels ($116, $117, $118, etc.)
    ctx.strokeStyle = '#2c2c2a';
    ctx.lineWidth = 1;
    ctx.fillStyle = '#898781';
    ctx.font = '10px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';

    const step = pRange > 10 ? 2 : pRange > 4 ? 1 : 0.5;
    const firstTick = Math.ceil(minPrice / step) * step;

    for (let price = firstTick; price <= maxPrice; price += step) {
      const y = getPriceY(price);
      if (y >= chartTop && y <= chartBottom) {
        ctx.beginPath();
        ctx.moveTo(paddingLeft, y);
        ctx.lineTo(containerWidth - paddingRight, y);
        ctx.stroke();

        ctx.fillText(`$${price.toFixed(step < 1 ? 2 : 0)}`, 10, y);
      }
    }

    // Vertical time grid lines & labels
    const timeStep = Math.max(5, Math.floor(numBars / 8));
    displayBars.forEach((bar, i) => {
      if (i % timeStep === 0 || i === numBars - 1) {
        const x = getBarX(i);
        ctx.beginPath();
        ctx.strokeStyle = '#2c2c2a';
        ctx.moveTo(x, chartTop);
        ctx.lineTo(x, chartBottom);
        ctx.stroke();

        const date = new Date(bar.time);
        const hours = date.getHours();
        const ampm = hours >= 12 ? 'PM' : 'AM';
        const displayH = hours % 12 || 12;
        const timeStr = `${displayH} ${ampm}`;

        ctx.fillStyle = '#898781';
        ctx.textAlign = 'center';
        ctx.fillText(timeStr, x, height - 10);
      }
    });

    // Draw SMA50 (grey dashed line)
    ctx.beginPath();
    ctx.strokeStyle = '#475569';
    ctx.lineWidth = 1.5;
    ctx.setLineDash([4, 2]);
    let hasSma = false;
    displayBars.forEach((bar, i) => {
      if (bar.sma50 != null) {
        const x = getBarX(i);
        const y = getPriceY(bar.sma50);
        if (!hasSma) {
          ctx.moveTo(x, y);
          hasSma = true;
        } else {
          ctx.lineTo(x, y);
        }
      }
    });
    ctx.stroke();
    ctx.setLineDash([]);

    // Draw Tenkan-sen (orange dashed line)
    ctx.beginPath();
    ctx.strokeStyle = '#eda100';
    ctx.lineWidth = 1.5;
    ctx.setLineDash([5, 3]);
    let hasTenkan = false;
    displayBars.forEach((bar, i) => {
      if (bar.tenkan != null) {
        const x = getBarX(i);
        const y = getPriceY(bar.tenkan);
        if (!hasTenkan) {
          ctx.moveTo(x, y);
          hasTenkan = true;
        } else {
          ctx.lineTo(x, y);
        }
      }
    });
    ctx.stroke();
    ctx.setLineDash([]);

    // Draw VWMA (purple solid line)
    ctx.beginPath();
    ctx.strokeStyle = '#a855f7';
    ctx.lineWidth = 2.5;
    let hasVwma = false;
    displayBars.forEach((bar, i) => {
      if (bar.vwma != null) {
        const x = getBarX(i);
        const y = getPriceY(bar.vwma);
        if (!hasVwma) {
          ctx.moveTo(x, y);
          hasVwma = true;
        } else {
          ctx.lineTo(x, y);
        }
      }
    });
    ctx.stroke();

    // Draw Candlesticks
    displayBars.forEach((bar, i) => {
      const x = getBarX(i);
      const isUp = bar.close >= bar.open;
      const color = isUp ? '#22c55e' : '#ef4444';

      const highY = getPriceY(bar.high);
      const lowY = getPriceY(bar.low);
      const openY = getPriceY(bar.open);
      const closeY = getPriceY(bar.close);

      // Wick
      ctx.beginPath();
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.5;
      ctx.moveTo(x, highY);
      ctx.lineTo(x, lowY);
      ctx.stroke();

      // Body
      const bodyTop = Math.min(openY, closeY);
      const bodyHeight = Math.max(2, Math.abs(closeY - openY));
      ctx.fillStyle = color;
      ctx.fillRect(x - candleBodyWidth / 2, bodyTop, candleBodyWidth, bodyHeight);
    });

    // Crosshair line if hovered
    if (hoverIndex !== null && hoverIndex >= 0 && hoverIndex < numBars) {
      const hx = getBarX(hoverIndex);
      ctx.beginPath();
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.4)';
      ctx.lineWidth = 1;
      ctx.setLineDash([3, 3]);
      ctx.moveTo(hx, chartTop);
      ctx.lineTo(hx, chartBottom);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    ctx.restore();
  }, [containerWidth, displayBars, numBars, barSpacing, candleBodyWidth, hoverIndex]);

  // --- DRAW CCI (20) CHART ---
  useEffect(() => {
    const canvas = cciCanvasRef.current;
    if (!canvas || numBars === 0) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const height = 90;
    canvas.width = containerWidth * dpr;
    canvas.height = height * dpr;
    canvas.style.width = `${containerWidth}px`;
    canvas.style.height = `${height}px`;

    ctx.save();
    ctx.scale(dpr, dpr);

    ctx.fillStyle = '#111110';
    ctx.fillRect(0, 0, containerWidth, height);

    const minCci = -320;
    const maxCci = 320;
    const cciRange = maxCci - minCci;
    const chartTop = 10;
    const chartBottom = height - 20;
    const plotHeight = chartBottom - chartTop;

    const getCciY = (val: number) => {
      const clamped = Math.max(minCci, Math.min(maxCci, val));
      return chartBottom - ((clamped - minCci) / cciRange) * plotHeight;
    };

    const getBarX = (idx: number) => paddingLeft + idx * barSpacing;

    // Reference lines: +300, +100, 0, -100, -300
    const refLevels = [
      { val: 300, label: '+300', dash: [2, 2] },
      { val: 100, label: '+100', dash: [3, 3] },
      { val: -100, label: '-100', dash: [3, 3] },
      { val: -300, label: '-300', dash: [2, 2] },
    ];

    ctx.lineWidth = 1;
    ctx.font = '9px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';

    refLevels.forEach(({ val, label, dash }) => {
      const y = getCciY(val);
      ctx.beginPath();
      ctx.strokeStyle = '#2c2c2a';
      ctx.setLineDash(dash);
      ctx.moveTo(paddingLeft, y);
      ctx.lineTo(containerWidth - paddingRight, y);
      ctx.stroke();

      ctx.fillStyle = '#898781';
      ctx.fillText(label, 10, y);
    });
    ctx.setLineDash([]);

    // Zero baseline
    const zeroY = getCciY(0);
    ctx.beginPath();
    ctx.strokeStyle = '#3a3a38';
    ctx.moveTo(paddingLeft, zeroY);
    ctx.lineTo(containerWidth - paddingRight, zeroY);
    ctx.stroke();

    // Vertical time grid lines & labels
    const timeStep = Math.max(5, Math.floor(numBars / 8));
    displayBars.forEach((bar, i) => {
      if (i % timeStep === 0 || i === numBars - 1) {
        const x = getBarX(i);
        ctx.beginPath();
        ctx.strokeStyle = '#2c2c2a';
        ctx.moveTo(x, chartTop);
        ctx.lineTo(x, chartBottom);
        ctx.stroke();

        const date = new Date(bar.time);
        const hh = date.getHours().toString().padStart(2, '0');
        const mm = date.getMinutes().toString().padStart(2, '0');
        ctx.fillStyle = '#898781';
        ctx.textAlign = 'center';
        ctx.fillText(`${hh}:${mm}`, x, height - 6);
      }
    });

    // Draw CCI curve
    ctx.beginPath();
    ctx.strokeStyle = '#ef4444'; // Red vibrant line matching reference screenshot
    ctx.lineWidth = 1.5;
    let started = false;

    displayBars.forEach((bar, i) => {
      if (bar.cci != null) {
        const x = getBarX(i);
        const y = getCciY(bar.cci);
        if (!started) {
          ctx.moveTo(x, y);
          started = true;
        } else {
          ctx.lineTo(x, y);
        }
      }
    });
    ctx.stroke();

    // Crosshair line if hovered
    if (hoverIndex !== null && hoverIndex >= 0 && hoverIndex < numBars) {
      const hx = getBarX(hoverIndex);
      ctx.beginPath();
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.4)';
      ctx.lineWidth = 1;
      ctx.setLineDash([3, 3]);
      ctx.moveTo(hx, chartTop);
      ctx.lineTo(hx, chartBottom);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    ctx.restore();
  }, [containerWidth, displayBars, numBars, barSpacing, hoverIndex]);

  // --- DRAW FISHER TRANSFORM (9) CHART ---
  useEffect(() => {
    const canvas = fishCanvasRef.current;
    if (!canvas || numBars === 0) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const height = 90;
    canvas.width = containerWidth * dpr;
    canvas.height = height * dpr;
    canvas.style.width = `${containerWidth}px`;
    canvas.style.height = `${height}px`;

    ctx.save();
    ctx.scale(dpr, dpr);

    ctx.fillStyle = '#111110';
    ctx.fillRect(0, 0, containerWidth, height);

    let minFish = -1.0;
    let maxFish = 8.5;
    displayBars.forEach((b) => {
      if (b.fisher != null) {
        if (b.fisher < minFish) minFish = b.fisher;
        if (b.fisher > maxFish) maxFish = b.fisher;
      }
      if (b.fisherSignal != null) {
        if (b.fisherSignal < minFish) minFish = b.fisherSignal;
        if (b.fisherSignal > maxFish) maxFish = b.fisherSignal;
      }
    });

    const fishRange = maxFish - minFish || 1;
    const chartTop = 10;
    const chartBottom = height - 20;
    const plotHeight = chartBottom - chartTop;

    const getFishY = (val: number) => {
      return chartBottom - ((val - minFish) / fishRange) * plotHeight;
    };

    const getBarX = (idx: number) => paddingLeft + idx * barSpacing;

    // Reference lines: 0.00, 4.00, 8.00
    const ticks = [0.0, 4.0, 8.0];
    ctx.lineWidth = 1;
    ctx.font = '9px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';

    ticks.forEach((val) => {
      if (val >= minFish - 0.5 && val <= maxFish + 0.5) {
        const y = getFishY(val);
        ctx.beginPath();
        ctx.strokeStyle = '#2c2c2a';
        ctx.moveTo(paddingLeft, y);
        ctx.lineTo(containerWidth - paddingRight, y);
        ctx.stroke();

        ctx.fillStyle = '#898781';
        ctx.fillText(val.toFixed(2), 10, y);
      }
    });

    // Vertical time grid lines & labels
    const timeStep = Math.max(5, Math.floor(numBars / 8));
    displayBars.forEach((bar, i) => {
      if (i % timeStep === 0 || i === numBars - 1) {
        const x = getBarX(i);
        ctx.beginPath();
        ctx.strokeStyle = '#2c2c2a';
        ctx.moveTo(x, chartTop);
        ctx.lineTo(x, chartBottom);
        ctx.stroke();

        const date = new Date(bar.time);
        const hh = date.getHours().toString().padStart(2, '0');
        const mm = date.getMinutes().toString().padStart(2, '0');
        ctx.fillStyle = '#898781';
        ctx.textAlign = 'center';
        ctx.fillText(`${hh}:${mm}`, x, height - 6);
      }
    });

    // 1. Draw Fisher Fill (blue translucent area)
    ctx.beginPath();
    let hasArea = false;
    const zeroY = getFishY(Math.max(minFish, 0));

    displayBars.forEach((bar, i) => {
      if (bar.fisher != null) {
        const x = getBarX(i);
        const y = getFishY(bar.fisher);
        if (!hasArea) {
          ctx.moveTo(x, zeroY);
          ctx.lineTo(x, y);
          hasArea = true;
        } else {
          ctx.lineTo(x, y);
        }
      }
    });

    if (hasArea) {
      const lastX = getBarX(displayBars.length - 1);
      ctx.lineTo(lastX, zeroY);
      ctx.closePath();
      ctx.fillStyle = 'rgba(42, 120, 214, 0.12)';
      ctx.fill();
    }

    // 2. Draw Fisher line (blue)
    ctx.beginPath();
    ctx.strokeStyle = '#2a78d6';
    ctx.lineWidth = 1.5;
    let startedFish = false;
    displayBars.forEach((bar, i) => {
      if (bar.fisher != null) {
        const x = getBarX(i);
        const y = getFishY(bar.fisher);
        if (!startedFish) {
          ctx.moveTo(x, y);
          startedFish = true;
        } else {
          ctx.lineTo(x, y);
        }
      }
    });
    ctx.stroke();

    // 3. Draw Signal line (red)
    ctx.beginPath();
    ctx.strokeStyle = '#dc2626';
    ctx.lineWidth = 1.5;
    let startedSig = false;
    displayBars.forEach((bar, i) => {
      if (bar.fisherSignal != null) {
        const x = getBarX(i);
        const y = getFishY(bar.fisherSignal);
        if (!startedSig) {
          ctx.moveTo(x, y);
          startedSig = true;
        } else {
          ctx.lineTo(x, y);
        }
      }
    });
    ctx.stroke();

    // Crosshair line if hovered
    if (hoverIndex !== null && hoverIndex >= 0 && hoverIndex < numBars) {
      const hx = getBarX(hoverIndex);
      ctx.beginPath();
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.4)';
      ctx.lineWidth = 1;
      ctx.setLineDash([3, 3]);
      ctx.moveTo(hx, chartTop);
      ctx.lineTo(hx, chartBottom);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    ctx.restore();
  }, [containerWidth, displayBars, numBars, barSpacing, hoverIndex]);

  // --- DRAW ATR (14) CHART ---
  useEffect(() => {
    const canvas = atrCanvasRef.current;
    if (!canvas || numBars === 0) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const height = 90;
    canvas.width = containerWidth * dpr;
    canvas.height = height * dpr;
    canvas.style.width = `${containerWidth}px`;
    canvas.style.height = `${height}px`;

    ctx.save();
    ctx.scale(dpr, dpr);

    ctx.fillStyle = '#111110';
    ctx.fillRect(0, 0, containerWidth, height);

    let minAtr = 0.2;
    let maxAtr = 1.6;
    displayBars.forEach((b) => {
      if (b.atr != null) {
        if (b.atr < minAtr) minAtr = b.atr;
        if (b.atr > maxAtr) maxAtr = b.atr;
      }
    });

    const atrRange = maxAtr - minAtr || 1;
    const chartTop = 10;
    const chartBottom = height - 20;
    const plotHeight = chartBottom - chartTop;

    const getAtrY = (val: number) => {
      return chartBottom - ((val - minAtr) / atrRange) * plotHeight;
    };

    const getBarX = (idx: number) => paddingLeft + idx * barSpacing;

    // Y ticks: 1.000, 1.500
    const ticks = [0.5, 1.0, 1.5];
    ctx.lineWidth = 1;
    ctx.font = '9px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';

    ticks.forEach((val) => {
      if (val >= minAtr - 0.2 && val <= maxAtr + 0.2) {
        const y = getAtrY(val);
        ctx.beginPath();
        ctx.strokeStyle = '#2c2c2a';
        ctx.moveTo(paddingLeft, y);
        ctx.lineTo(containerWidth - paddingRight, y);
        ctx.stroke();

        ctx.fillStyle = '#898781';
        ctx.fillText(val.toFixed(3), 10, y);
      }
    });

    // Vertical time grid lines & labels
    const timeStep = Math.max(5, Math.floor(numBars / 8));
    displayBars.forEach((bar, i) => {
      if (i % timeStep === 0 || i === numBars - 1) {
        const x = getBarX(i);
        ctx.beginPath();
        ctx.strokeStyle = '#2c2c2a';
        ctx.moveTo(x, chartTop);
        ctx.lineTo(x, chartBottom);
        ctx.stroke();

        const date = new Date(bar.time);
        const hh = date.getHours().toString().padStart(2, '0');
        const mm = date.getMinutes().toString().padStart(2, '0');
        ctx.fillStyle = '#898781';
        ctx.textAlign = 'center';
        ctx.fillText(`${hh}:${mm}`, x, height - 6);
      }
    });

    // 1. Draw ATR Fill (green translucent)
    ctx.beginPath();
    let hasArea = false;
    const bottomY = chartBottom;

    displayBars.forEach((bar, i) => {
      if (bar.atr != null) {
        const x = getBarX(i);
        const y = getAtrY(bar.atr);
        if (!hasArea) {
          ctx.moveTo(x, bottomY);
          ctx.lineTo(x, y);
          hasArea = true;
        } else {
          ctx.lineTo(x, y);
        }
      }
    });

    if (hasArea) {
      const lastX = getBarX(displayBars.length - 1);
      ctx.lineTo(lastX, bottomY);
      ctx.closePath();
      ctx.fillStyle = 'rgba(34, 197, 94, 0.1)';
      ctx.fill();
    }

    // 2. Draw ATR line (green)
    ctx.beginPath();
    ctx.strokeStyle = '#22c55e';
    ctx.lineWidth = 1.5;
    let startedAtr = false;
    displayBars.forEach((bar, i) => {
      if (bar.atr != null) {
        const x = getBarX(i);
        const y = getAtrY(bar.atr);
        if (!startedAtr) {
          ctx.moveTo(x, y);
          startedAtr = true;
        } else {
          ctx.lineTo(x, y);
        }
      }
    });
    ctx.stroke();

    // Crosshair line if hovered
    if (hoverIndex !== null && hoverIndex >= 0 && hoverIndex < numBars) {
      const hx = getBarX(hoverIndex);
      ctx.beginPath();
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.4)';
      ctx.lineWidth = 1;
      ctx.setLineDash([3, 3]);
      ctx.moveTo(hx, chartTop);
      ctx.lineTo(hx, chartBottom);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    ctx.restore();
  }, [containerWidth, displayBars, numBars, barSpacing, hoverIndex]);

  // Handle Mouse Hover / Crosshair tracking
  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!containerRef.current || numBars === 0) return;
    const rect = containerRef.current.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const plotX = mouseX - paddingLeft;
    if (plotX >= 0 && plotX <= chartWidth) {
      const idx = Math.round(plotX / barSpacing);
      const clamped = Math.max(0, Math.min(numBars - 1, idx));
      setHoverIndex(clamped);
    } else {
      setHoverIndex(null);
    }
  };

  const handleMouseLeave = () => {
    setHoverIndex(null);
  };

  const activeHoverBar = hoverIndex !== null && hoverIndex >= 0 && hoverIndex < numBars ? displayBars[hoverIndex] : null;

  return (
    <div
      ref={containerRef}
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
      className="space-y-4 pt-2 font-sans select-none"
    >
      {/* Multi-Timeframe Controller Bar for All Graphs */}
      <div className="bg-[#18191a] border border-white/10 rounded-xl p-3 sm:p-3.5 flex flex-wrap items-center justify-between gap-3 shadow-md">
        <div className="flex items-center gap-2.5">
          <div className="w-2.5 h-2.5 rounded-full bg-emerald-400 animate-pulse" />
          <span className="text-xs font-bold text-white uppercase tracking-wider">
            All Graphs Timeframe:
          </span>
          <span className="text-[11px] font-mono px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 font-bold">
            {timeframe.toUpperCase()}
          </span>
        </div>

        <div className="flex items-center gap-1 sm:gap-1.5 flex-wrap">
          <span className="text-[10px] uppercase font-bold text-neutral-400 mr-1 hidden sm:inline">
            Select:
          </span>
          {TIMEFRAMES.map((tf) => {
            const isActive = timeframe === tf.id;
            return (
              <button
                key={tf.id}
                onClick={() => onTimeframeChange && onTimeframeChange(tf.id)}
                className={`px-2.5 py-1 text-xs font-mono font-bold rounded-lg transition-all cursor-pointer ${
                  isActive
                    ? 'bg-emerald-500 text-black shadow-lg shadow-emerald-500/20 ring-1 ring-emerald-400'
                    : 'bg-neutral-800/80 hover:bg-neutral-700 text-neutral-300 hover:text-white border border-white/5'
                }`}
                title={`Switch all graphs (Candlesticks, CCI, Fisher, ATR) to ${tf.label}`}
              >
                {tf.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Dynamic Hover Inspector Bar */}
      {activeHoverBar ? (
        <div className="bg-[#1c1c1a] border border-white/10 rounded-lg px-3 py-1.5 text-[11px] font-mono flex items-center justify-between flex-wrap gap-2 text-neutral-300 animate-fadeIn">
          <div className="flex items-center gap-3 flex-wrap">
            <span className="text-neutral-400 font-bold">{new Date(activeHoverBar.time).toLocaleTimeString()}</span>
            <span>O: <b className="text-white">${activeHoverBar.open.toFixed(2)}</b></span>
            <span>H: <b className="text-emerald-400">${activeHoverBar.high.toFixed(2)}</b></span>
            <span>L: <b className="text-rose-400">${activeHoverBar.low.toFixed(2)}</b></span>
            <span>C: <b className={activeHoverBar.close >= activeHoverBar.open ? 'text-emerald-400' : 'text-rose-400'}>${activeHoverBar.close.toFixed(2)}</b></span>
          </div>
          <div className="flex items-center gap-3 flex-wrap text-neutral-400">
            {activeHoverBar.tenkan != null && (
              <span>Tenkan: <b className="text-amber-400">${activeHoverBar.tenkan.toFixed(2)}</b></span>
            )}
            {activeHoverBar.vwma != null && (
              <span>VWMA: <b className="text-purple-400">${activeHoverBar.vwma.toFixed(2)}</b></span>
            )}
            {activeHoverBar.cci != null && (
              <span>CCI: <b className={activeHoverBar.cci >= 0 ? 'text-emerald-400' : 'text-rose-400'}>{activeHoverBar.cci.toFixed(1)}</b></span>
            )}
            {activeHoverBar.fisher != null && (
              <span>Fisher: <b className="text-blue-400">{activeHoverBar.fisher.toFixed(2)}</b></span>
            )}
            {activeHoverBar.atr != null && (
              <span>ATR: <b className="text-emerald-400">{activeHoverBar.atr.toFixed(3)}</b></span>
            )}
          </div>
        </div>
      ) : null}

      {/* 1. PRICE CANDLESTICKS WITH TENKAN-SEN, VWMA, AND SMA50 */}
      <div className="bg-[#111110] border border-white/10 rounded-lg p-3 sm:p-4 shadow-md">
        <div className="text-[11px] text-[#898781] font-mono mb-2 flex items-center justify-between flex-wrap gap-2">
          <span>
            Price | Tenkan-sen (orange dashed) | VWMA (purple solid) | SMA50 (grey dashed)
          </span>
          <div className="flex items-center gap-2">
            <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-white/5 text-emerald-400 border border-emerald-500/30">
              {timeframe}
            </span>
            <span className="text-[10px] text-neutral-500 font-bold">{currentAsset}/USDT</span>
          </div>
        </div>
        <div className="relative w-full h-[280px]">
          <canvas ref={priceCanvasRef} className="block w-full h-[280px]" />
        </div>
      </div>

      {/* 2. CCI (20) OSCILLATOR */}
      <div className="bg-[#111110] border border-white/10 rounded-lg p-3 sm:p-4 shadow-md">
        <div className="text-[11px] text-[#898781] font-mono mb-2 flex items-center justify-between flex-wrap gap-2">
          <span>CCI (20) scale ±200, overbought/oversold at ±100</span>
          <div className="flex items-center gap-2">
            <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-white/5 text-neutral-400 border border-white/10">
              {timeframe}
            </span>
            {displayBars.length > 0 && displayBars[displayBars.length - 1].cci != null && (
              <span className={`text-[10px] font-bold ${displayBars[displayBars.length - 1].cci! >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                CCI: {displayBars[displayBars.length - 1].cci!.toFixed(1)}
              </span>
            )}
          </div>
        </div>
        <div className="relative w-full h-[90px]">
          <canvas ref={cciCanvasRef} className="block w-full h-[90px]" />
        </div>
      </div>

      {/* 3. FISHER TRANSFORM (9) */}
      <div className="bg-[#111110] border border-white/10 rounded-lg p-3 sm:p-4 shadow-md">
        <div className="text-[11px] text-[#898781] font-mono mb-2 flex items-center justify-between flex-wrap gap-2">
          <span>Fisher Transform (9) — blue: Fisher · red: Signal line</span>
          <div className="flex items-center gap-2">
            <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-white/5 text-neutral-400 border border-white/10">
              {timeframe}
            </span>
            {displayBars.length > 0 && displayBars[displayBars.length - 1].fisher != null && (
              <span className="text-[10px] font-bold text-blue-400">
                Fish: {displayBars[displayBars.length - 1].fisher!.toFixed(2)}
              </span>
            )}
          </div>
        </div>
        <div className="relative w-full h-[90px]">
          <canvas ref={fishCanvasRef} className="block w-full h-[90px]" />
        </div>
      </div>

      {/* 4. ATR (14) AVERAGE TRUE RANGE */}
      <div className="bg-[#111110] border border-white/10 rounded-lg p-3 sm:p-4 shadow-md">
        <div className="text-[11px] text-[#898781] font-mono mb-2 flex items-center justify-between flex-wrap gap-2">
          <span>ATR (14) — Average True Range</span>
          <div className="flex items-center gap-2">
            <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-white/5 text-neutral-400 border border-white/10">
              {timeframe}
            </span>
            {displayBars.length > 0 && displayBars[displayBars.length - 1].atr != null && (
              <span className="text-[10px] font-bold text-emerald-400">
                ATR: {displayBars[displayBars.length - 1].atr!.toFixed(3)}
              </span>
            )}
          </div>
        </div>
        <div className="relative w-full h-[90px]">
          <canvas ref={atrCanvasRef} className="block w-full h-[90px]" />
        </div>
      </div>
    </div>
  );
};
