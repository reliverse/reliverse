"use client";

import { useEffect, useRef } from "react";

export function AnimatedGridBackground() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let animationFrameId: number;
    let mouseX = 0;
    let mouseY = 0;

    const resize = () => {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
    };

    const handleMouseMove = (e: MouseEvent) => {
      mouseX = e.clientX;
      mouseY = e.clientY;
    };

    resize();
    window.addEventListener("resize", resize);
    window.addEventListener("mousemove", handleMouseMove);

    const gridSize = 40;
    const dotRadius = 1;

    const draw = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      const isDark = document.documentElement.classList.contains("dark");
      const baseColor = isDark ? "255, 255, 255" : "0, 0, 0";
      const accentColor = isDark ? "139, 92, 246" : "124, 58, 237"; // violet-500/600

      for (let x = 0; x < canvas.width; x += gridSize) {
        for (let y = 0; y < canvas.height; y += gridSize) {
          const distance = Math.sqrt((x - mouseX) ** 2 + (y - mouseY) ** 2);
          const maxDistance = 200;
          const proximity = Math.max(0, 1 - distance / maxDistance);

          // Base opacity
          const baseOpacity = 0.08;
          // Enhanced opacity near mouse
          const opacity = baseOpacity + proximity * 0.3;

          // Color interpolation
          if (proximity > 0.1) {
            ctx.fillStyle = `rgba(${accentColor}, ${proximity * 0.5})`;
          } else {
            ctx.fillStyle = `rgba(${baseColor}, ${opacity})`;
          }

          ctx.beginPath();
          ctx.arc(x, y, dotRadius + proximity * 1.5, 0, Math.PI * 2);
          ctx.fill();
        }
      }

      animationFrameId = requestAnimationFrame(draw);
    };

    draw();

    return () => {
      window.removeEventListener("resize", resize);
      window.removeEventListener("mousemove", handleMouseMove);
      cancelAnimationFrame(animationFrameId);
    };
  }, []);

  return <canvas ref={canvasRef} className="pointer-events-none fixed inset-0 -z-10 opacity-60" />;
}
