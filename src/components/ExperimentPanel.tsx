import { useEffect, useState } from 'react';
import type { Settings } from '../models/types';
import type { Simulation } from '../simulation/Simulation';
import type { Tool } from './SimulationCanvas';
import { lToGal } from '../utils/units';
import { RESPRAY_AFTER_RAIN } from '../simulation/Weather';

const TOOL_HINTS: Record<Tool, string> = {
  none: '',
  zone: 'Drag on the map to draw a spray zone.',
  repellent: 'Click the map to place a Repellent A device.',
  attractant: 'Click the map to place an Attractant B device.',
  trap: 'Click the map to place an attractant with a sticky trap.',
  erase: 'Click a device or zone to remove it.'
};

/**
 * One-line explanation of what the drone is doing right now. `detailed` adds
 * the minutes of flying left before the battery reserve (Playground).
 */
export function droneStatus(sim: Simulation, detailed = true): string {
  const d = sim.drone;
  const mass = sim.settings.devices.massKg;
  const load =
    sim.settings.treatment === 'spray'
      ? `tank ${lToGal(d.payloadL).toFixed(1)} gal`
      : d.devicesOnboard > 0
        ? `${d.devicesOnboard} device${d.devicesOnboard === 1 ? '' : 's'} on board`
        : 'empty';
  const battery =
    `battery ${Math.round(Math.max(0, d.battery) * 100)}%` + (detailed ? ` (${d.minutesLeft(mass).toFixed(1)} min before reserve)` : '');
  if (d.hoverFor === 'takeoff') return `Drone is taking off and climbing to working height · ${load} · ${battery}.`;
  if (d.hoverFor === 'landing') return `Drone is landing at home (H) · ${battery}.`;
  if (d.hoverFor === 'turn') return `Drone is turning around at the end of a pass · ${load} · ${battery}.`;
  if (d.hoverFor === 'drop') return `Drone is hovering low to drop a device · ${load} · ${battery}.`;
  switch (d.mode) {
    case 'parked':
      if (sim.raining && d.tasks.length) return 'Drone is waiting at home (H) for the rain to stop. It can\'t fly or spray in the rain.';
      if (sim.raining && sim.settings.treatment === 'spray' && sim.settings.drone.resprayEveryDays === RESPRAY_AFTER_RAIN)
        return 'It is raining, so the spray is washing off. The drone will spray again when the rain stops.';
      if (sim.treatmentScheduled)
        return `Drone is waiting at home (H). The treatment starts on Day ${sim.settings.run.treatStartDay ?? 1}.`;
      if (sim.treatmentWaiting) return 'Drone is waiting at home (H) until you press Run to start the treatment.';
      if (d.outOfBudget) return 'Drone is parked: the money for this season is used up, so the rest of the plan was skipped.';
      if (d.outOfProduct) return 'Drone is parked: it ran out of product.';
      if (d.gaveUp) return 'Drone is parked: the job is too far for one battery.';
      return d.flights > 0 ? 'Drone is parked: all jobs done.' : 'Drone is parked at home (H), waiting for a plan.';
    case 'turnaround':
      return `Drone is on the ground: refilling and swapping the battery (${Math.ceil(d.turnaroundLeft)} s left).`;
    case 'returning':
      return d.lastReturnReason === 'rain'
        ? 'Drone is flying home: it started to rain.'
        : d.lastReturnReason === 'budget'
        ? 'Drone is flying home: the money is almost used up, so it stops here.'
        : d.lastReturnReason === 'battery'
        ? `Drone is flying home: the battery reached the reserve (${battery}).`
        : d.lastReturnReason === 'refill'
          ? 'Drone is flying home to refill the tank.'
          : d.lastReturnReason === 'reload devices'
            ? 'Drone is flying home to pick up more devices.'
            : 'Drone is flying home: jobs done.';
    default: {
      const t = d.tasks[0];
      const job = t?.kind === 'drop' ? 'carrying a device to its spot' : d.spraying ? 'spraying' : 'flying to the next spray strip';
      return `Drone is ${job} · ${load} · ${battery}.`;
    }
  }
}

function tipsFor(s: Settings, sim: Simulation): string[] {
  const tips: string[] = [];
  if (s.treatment === 'none') tips.push('No treatment is your baseline: it shows what happens naturally.');
  if (s.treatment === 'spray') {
    tips.push('Spray coats the plants right away, but natural scents evaporate in a few days. Watch the purple fade.');
    tips.push('After the run, check the chart: when does scent coverage start to drop, and what do the pests do then?');
    if ((s.drone.resprayEveryDays ?? 0) === 0) tips.push('This plan sprays only once. What would spraying again every week change, and what would it cost?');
  }
  if (s.treatment === 'slowRelease' || s.treatment === 'pushPull') {
    tips.push('Each device only protects the dashed circle around it. Where are the gaps between circles?');
    tips.push('Watch where the pests go. Do they leave the field, or just move to a spot with no scent?');
  }
  if (s.treatment === 'slowRelease') tips.push('Devices keep giving off scent for weeks. A spray of natural scent fades in a few days. Which matters more here?');
  if ((s.treatment === 'slowRelease' || s.treatment === 'pushPull') && s.wind.speedMph > 0)
    tips.push('Wind pushes each device\'s scent downwind. Does a device protect more crop upwind or downwind of it?');
  if (s.treatment === 'pushPull') tips.push('Push-pull: the repellent pushes pests off the crop while the attractant pulls them somewhere else.');
  if (sim.rains.length) {
    tips.push('Rain washes most of the spray off the leaves. Devices keep their scent inside, so they keep working.');
    if (s.treatment === 'spray') tips.push('Look at the forecast. Is it worth spraying right before it rains?');
  }
  if (s.wind.speedMph > 0) tips.push('Wind can carry scent farther in one direction.');
  if (s.wind.speedMph >= 12) tips.push('Strong wind carries scent far, but it also spreads it thin.');
  if (s.scent.lifetimeMin <= 1) tips.push('This scent only lasts a short time. What happens when it fades?');
  if (sim.surveys.length) tips.push('Survey results may not show every pest.');
  else tips.push('Do you know where the pests are? A survey drone could help you find out.');
  tips.push('Pests shown in orange are being bothered by repellent; dark pests are feeding or flying normally.');
  if (s.treatment !== 'none' && (s.scent.effectivenessPct ?? 100) < 100) tips.push('Blue pests ignore the scent completely. No scent works on every pest.');
  tips.push('Change one thing at a time so you know what caused the difference.');
  return tips;
}

interface PanelProps {
  settings: Settings;
  sim: Simulation;
  tool: Tool;
  running: boolean;
  /** False while Guided mode keeps Run locked, so "Press Run" would confuse. */
  canRun?: boolean;
  /** Show extra drone numbers (Playground). */
  detailed?: boolean;
}

export function ExperimentPanel({ settings, sim, tool, running, canRun = true, detailed = true }: PanelProps) {
  const [i, setI] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setI((x) => x + 1), 9000);
    return () => clearInterval(t);
  }, []);
  const tips = tipsFor(settings, sim);
  const tip = tips[i % tips.length];
  const toolHint = TOOL_HINTS[tool];
  // One line: the most useful thing to know right now.
  let line: { icon: string; text: string; tone: string };
  if (sim.surveying) line = { icon: '🛰️', text: 'Survey drone is scanning the field…', tone: 'status-line' };
  else if (running && settings.treatment !== 'none') line = { icon: '🚁', text: droneStatus(sim, detailed), tone: 'status-line' };
  else if (!running && toolHint && !sim.finished) line = { icon: '✏️', text: toolHint, tone: 'tool-hint' };
  else if (!running && !sim.runStarted && canRun) line = { icon: '▶', text: 'Press Run to start.', tone: 'hint-strong' };
  else line = { icon: '💡', text: tip, tone: 'tip' };
  return (
    <div className="explain" role="status">
      <span className={line.tone}>
        {line.icon} {line.text}
      </span>
    </div>
  );
}
