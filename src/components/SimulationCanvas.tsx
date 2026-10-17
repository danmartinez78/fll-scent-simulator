import { useEffect, useRef, useState, type MutableRefObject } from 'react';
import type { Rect, Settings, SurveyResult, TreatmentPlan, Vec, ViewOptions } from '../models/types';
import type { Simulation } from '../simulation/Simulation';
import { activePlan, allowedKinds, usesSprayZones } from '../simulation/Treatment';
import { computeViewport, drawScene, toWorld, type SurveyLayer, type Viewport } from '../render/drawScene';
import { clamp, dist, inRect, rectFromPoints } from '../utils/geometry';
import { ClickGuard, type Press } from './clickGuard';

export type Tool = 'none' | 'zone' | 'repellent' | 'attractant' | 'trap' | 'erase';

interface Props {
  simRef: MutableRefObject<Simulation>;
  view: ViewOptions;
  surveyLayer: SurveyLayer;
  survey: SurveyResult | null;
  tool: Tool;
  plan: TreatmentPlan;
  settings: Settings;
  onPlan: (p: TreatmentPlan) => void;
}

const CURSORS: Record<Tool, string> = {
  none: 'default',
  zone: 'crosshair',
  repellent: 'copy',
  attractant: 'copy',
  trap: 'copy',
  erase: 'not-allowed'
};

/** How far outside the field edge (in screen pixels) a press still counts as on the field. */
const FIELD_SLACK_PX = 8;

export function SimulationCanvas(props: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const propsRef = useRef(props);
  propsRef.current = props;
  const vpRef = useRef<Viewport>({ scale: 1, ox: 0, oy: 0 });
  const dragRef = useRef<{ start: Vec; cur: Vec } | null>(null);
  const guardRef = useRef(new ClickGuard());
  const [message, setMessage] = useState<string | null>(null);

  // Watch dropdown menus: their native popups can sit on top of the map, and
  // presses that pick an option or close the menu must not land on the map.
  useEffect(() => {
    const guard = guardRef.current;
    const menuOf = (t: EventTarget | null) => (t instanceof Element ? t.closest('select') : null);
    const onDown = (e: PointerEvent) => {
      if (e.target === canvasRef.current) return;
      const menu = menuOf(e.target);
      if (menu) guard.menuPressed(menu, performance.now());
      else guard.pressedElsewhere(performance.now());
    };
    const onClose = (e: Event) => {
      if (menuOf(e.target)) guard.menuClosed(performance.now());
    };
    const onBlur = (e: FocusEvent) => {
      // Moving focus from one dropdown straight to another keeps a menu open.
      if (menuOf(e.target) && !menuOf(e.relatedTarget)) guard.menuClosed(performance.now());
    };
    const onKey = (e: KeyboardEvent) => {
      if (['Enter', 'Escape', 'Tab', ' '].includes(e.key)) onClose(e);
    };
    document.addEventListener('pointerdown', onDown, true);
    document.addEventListener('change', onClose, true);
    document.addEventListener('focusout', onBlur, true);
    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('pointerdown', onDown, true);
      document.removeEventListener('change', onClose, true);
      document.removeEventListener('focusout', onBlur, true);
      document.removeEventListener('keydown', onKey, true);
    };
  }, []);

  // Keep the canvas sharp and sized to its box.
  useEffect(() => {
    const canvas = canvasRef.current!;
    const wrap = wrapRef.current!;
    const resize = () => {
      const r = wrap.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      canvas.width = Math.max(1, Math.round(r.width * dpr));
      canvas.height = Math.max(1, Math.round(r.height * dpr));
      canvas.style.width = `${r.width}px`;
      canvas.style.height = `${r.height}px`;
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(wrap);
    return () => ro.disconnect();
  }, []);

  // Draw every frame.
  useEffect(() => {
    let raf = 0;
    const draw = (now: number) => {
      const canvas = canvasRef.current;
      if (canvas) {
        const ctx = canvas.getContext('2d')!;
        const dpr = window.devicePixelRatio || 1;
        const p = propsRef.current;
        const sim = p.simRef.current;
        const cw = canvas.width / dpr;
        const ch = canvas.height / dpr;
        const vp = computeViewport(cw, ch, sim.settings.field.width, sim.settings.field.height, 12);
        vpRef.current = vp;
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        const drag = dragRef.current;
        drawScene(
          ctx,
          sim,
          {
            view: p.view,
            surveyLayer: p.surveyLayer,
            survey: p.survey,
            draftZone: drag ? rectFromPoints(drag.start, drag.cur) : null,
            clock: now / 1000
          },
          vp
        );
      }
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, []);

  useEffect(() => {
    if (!message) return;
    const t = setTimeout(() => setMessage(null), 3500);
    return () => clearTimeout(t);
  }, [message]);

  /**
   * Whether a screen point is on the field. Presses on the empty map around
   * the field never draw or place anything, and on a touch screen they scroll
   * the page instead.
   */
  const onField = (clientX: number, clientY: number): boolean => {
    const canvas = canvasRef.current;
    if (!canvas) return false;
    const r = canvas.getBoundingClientRect();
    const vp = vpRef.current;
    const { field } = propsRef.current.simRef.current.settings;
    const p = toWorld(vp, clientX - r.left, clientY - r.top);
    const slack = FIELD_SLACK_PX / Math.max(1e-6, vp.scale);
    return p.x >= -slack && p.y >= -slack && p.x <= field.width + slack && p.y <= field.height + slack;
  };

  // A touch that starts on the field draws; anywhere else on the map it
  // scrolls the page as usual. touch-action can't vary across one canvas,
  // so block the scroll from touchstart instead.
  useEffect(() => {
    const canvas = canvasRef.current!;
    const onTouchStart = (e: TouchEvent) => {
      const t = e.touches[0];
      if (propsRef.current.tool !== 'none' && e.touches.length === 1 && onField(t.clientX, t.clientY)) e.preventDefault();
    };
    canvas.addEventListener('touchstart', onTouchStart, { passive: false });
    return () => canvas.removeEventListener('touchstart', onTouchStart);
  }, []);

  const worldPoint = (e: React.PointerEvent): Vec => {
    const r = canvasRef.current!.getBoundingClientRect();
    const sim = propsRef.current.simRef.current;
    const p = toWorld(vpRef.current, e.clientX - r.left, e.clientY - r.top);
    return {
      x: clamp(p.x, 0, sim.settings.field.width),
      y: clamp(p.y, 0, sim.settings.field.height)
    };
  };

  const pressOf = (e: React.PointerEvent): Press => ({ pointerId: e.pointerId, x: e.clientX, y: e.clientY });

  const onPointerDown = (e: React.PointerEvent) => {
    const { tool, settings } = propsRef.current;
    if (tool === 'none') return;
    if (!onField(e.clientX, e.clientY)) {
      guardRef.current.cancel();
      return;
    }
    if (!guardRef.current.down(pressOf(e), performance.now(), e.isPrimary && e.button === 0)) return;
    (e.target as Element).setPointerCapture(e.pointerId);
    if (tool === 'zone' && usesSprayZones(settings.treatment)) {
      const pt = worldPoint(e);
      dragRef.current = { start: pt, cur: pt };
    }
  };

  /** A full click on the map: erase or place a device. */
  const onClick = (pt: Vec) => {
    const { tool, plan, settings, onPlan } = propsRef.current;
    if (tool === 'erase') {
      const eff = activePlan(plan, settings.treatment);
      // Nearest device within reach, otherwise the smallest zone under the pointer.
      const reach = 10 / Math.max(0.2, vpRef.current.scale) + 2;
      let best: number | null = null;
      let bestD = reach;
      for (const d of eff.devices) {
        const dd = dist(d.x, d.y, pt.x, pt.y);
        if (dd < bestD) {
          bestD = dd;
          best = d.id;
        }
      }
      if (best !== null) {
        onPlan({ ...plan, devices: plan.devices.filter((d) => d.id !== best) });
        return;
      }
      const zones = eff.sprayZones.filter((z) => inRect(pt.x, pt.y, z));
      if (zones.length) {
        const smallest = zones.reduce((a, b) => (a.w * a.h <= b.w * b.h ? a : b));
        onPlan({ ...plan, sprayZones: plan.sprayZones.filter((z) => z !== smallest) });
      }
      return;
    }
    // Place a device.
    const kind = tool === 'repellent' ? 'repellent' : 'attractant';
    if (!allowedKinds(settings.treatment).includes(kind)) return;
    const used = activePlan(plan, settings.treatment).devices.length;
    if (used >= settings.devices.maxDevices) {
      setMessage(`All ${settings.devices.maxDevices} devices are placed. Use the eraser to remove one, or allow more devices.`);
      return;
    }
    const id = plan.devices.reduce((m, d) => Math.max(m, d.id), 0) + 1;
    onPlan({
      ...plan,
      devices: [...plan.devices, { id, x: pt.x, y: pt.y, kind, trap: tool === 'trap' }]
    });
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (dragRef.current) dragRef.current.cur = worldPoint(e);
  };

  const onPointerUp = (e: React.PointerEvent) => {
    const drag = dragRef.current;
    dragRef.current = null;
    const clicked = guardRef.current.up(pressOf(e), performance.now());
    if (!drag) {
      const { tool } = propsRef.current;
      if (clicked && tool !== 'none' && tool !== 'zone') onClick(worldPoint(e));
      return;
    }
    const { plan, onPlan } = propsRef.current;
    const z: Rect = rectFromPoints(drag.start, drag.cur);
    if (z.w < 4 || z.h < 4) {
      setMessage('Drag across the map to draw a spray zone.');
      return;
    }
    onPlan({ ...plan, sprayZones: [...plan.sprayZones, z] });
  };

  return (
    <div className="sim-canvas" ref={wrapRef}>
      <canvas
        ref={canvasRef}
        style={{ cursor: CURSORS[props.tool], touchAction: 'manipulation' }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={() => {
          dragRef.current = null;
          guardRef.current.cancel();
        }}
        aria-label="Top-down map of the field. Pests are small dots (blue ones ignore scent); purple clouds are repellent, orange clouds are attractant."
        role="img"
      />
      {message && <div className="canvas-msg">{message}</div>}
    </div>
  );
}
