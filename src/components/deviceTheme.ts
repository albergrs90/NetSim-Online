import { Monitor, Network, Router, Server, type LucideIcon } from 'lucide-react';
import type { DeviceType } from '../types/network';

export interface DeviceTheme {
  icon: LucideIcon;
  text: string;
  bg: string;
  border: string;
  dot: string;
  ring: string;
  hex: string;
}

export const DEVICE_THEME: Record<DeviceType, DeviceTheme> = {
  router: {
    icon: Router,
    text: 'text-violet-300',
    bg: 'bg-violet-500/10',
    border: 'border-violet-400/30',
    dot: 'bg-violet-400',
    ring: 'ring-violet-400/20',
    hex: '#a78bfa',
  },
  switch: {
    icon: Network,
    text: 'text-cyan-300',
    bg: 'bg-cyan-500/10',
    border: 'border-cyan-400/30',
    dot: 'bg-cyan-400',
    ring: 'ring-cyan-400/20',
    hex: '#22d3ee',
  },
  server: {
    icon: Server,
    text: 'text-amber-300',
    bg: 'bg-amber-500/10',
    border: 'border-amber-400/30',
    dot: 'bg-amber-400',
    ring: 'ring-amber-400/20',
    hex: '#fbbf24',
  },
  pc: {
    icon: Monitor,
    text: 'text-emerald-300',
    bg: 'bg-emerald-500/10',
    border: 'border-emerald-400/30',
    dot: 'bg-emerald-400',
    ring: 'ring-emerald-400/20',
    hex: '#34d399',
  },
};

export const DEVICE_ICON = (type: DeviceType): LucideIcon => DEVICE_THEME[type].icon;
