"use client";

import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import type { ChartPoint } from "@/lib/types";

interface Props {
  data: ChartPoint[];
  className?: string;
}

const CustomTooltip = ({ active, payload, label }: any) => {
  if (active && payload && payload.length) {
    return (
      <div
        className="rounded-xl px-3 py-2 text-xs"
        style={{
          background: "rgba(10,10,30,0.95)",
          border: "1px solid rgba(255,255,255,0.1)",
          boxShadow: "0 8px 32px rgba(0,0,0,0.4)",
        }}
      >
        <p className="text-white/50 mb-1.5 font-medium">{label}</p>
        {payload.map((p: any) => (
          <div key={p.name} className="flex items-center gap-2 mb-0.5">
            <div className="w-2 h-2 rounded-full" style={{ background: p.color }} />
            <span className="text-white/60 capitalize">{p.name}:</span>
            <span className="text-white font-semibold">{p.value}</span>
          </div>
        ))}
      </div>
    );
  }
  return null;
};

export function UsageChart({ data, className }: Props) {
  return (
    <div className={className} style={{ height: 200 }}>
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 5, right: 5, left: -20, bottom: 0 }}>
          <defs>
            <linearGradient id="colorContent" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="#E9863B" stopOpacity={0.3} />
              <stop offset="95%" stopColor="#E9863B" stopOpacity={0} />
            </linearGradient>
            <linearGradient id="colorVideos" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="#06b6d4" stopOpacity={0.3} />
              <stop offset="95%" stopColor="#06b6d4" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" />
          <XAxis
            dataKey="date"
            tick={{ fontSize: 10, fill: "rgba(190,178,160,0.5)" }}
            axisLine={false}
            tickLine={false}
          />
          <YAxis
            tick={{ fontSize: 10, fill: "rgba(190,178,160,0.5)" }}
            axisLine={false}
            tickLine={false}
          />
          <Tooltip content={<CustomTooltip />} />
          <Area
            type="monotone"
            dataKey="content"
            stroke="#E9863B"
            strokeWidth={2}
            fill="url(#colorContent)"
            dot={false}
          />
          <Area
            type="monotone"
            dataKey="videos"
            stroke="#06b6d4"
            strokeWidth={2}
            fill="url(#colorVideos)"
            dot={false}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
