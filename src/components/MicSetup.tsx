import React from "react";
import { Mic } from "lucide-react";
import { CollapsibleSection } from "./CollapsibleSection";
import { DEVICE_FALLBACK_NOTICE } from "../lib/audioCapture";
import type { AudioInputDevice } from "../lib/audioCapture";

/** The `<select>` value standing in for "no explicit device id" (system default). */
const SYSTEM_DEFAULT_VALUE = "__system_default__";

export interface MicSetupProps {
  /** Every audio-input device the browser currently reports (D-36) — empty until permission is granted. */
  devices: AudioInputDevice[];
  /** `undefined` means the system default and is never persisted (D-36). */
  selectedDeviceId: string | undefined;
  onSelectDevice: (deviceId: string | undefined) => void;
  /** True once the chosen device could not be honoured and the live stream fell back to the system default. */
  fellBackToDefault: boolean;
  /** Disabled whenever a recording is active — a change here must be impossible, not merely discouraged. */
  disabled: boolean;
}

/**
 * Hosts the D-36 input-device picker and, once Task 2 adds it, the D-37
 * both-voices pre-flight — one panel rather than two, since the pre-flight
 * drives the same level meter the picker's chosen device feeds. Wrapped in
 * the existing `CollapsibleSection` so a collapsed override still shows on
 * the header via `badge`.
 */
export const MicSetup: React.FC<MicSetupProps> = ({
  devices,
  selectedDeviceId,
  onSelectDevice,
  fellBackToDefault,
  disabled,
}) => {
  const selectedDevice = devices.find((device) => device.deviceId === selectedDeviceId);
  // Only an actual override is worth surfacing on the collapsed header — the
  // system default is the unmarked case and needs no badge.
  const badge = selectedDeviceId ? (selectedDevice?.label ?? null) : null;

  return (
    <CollapsibleSection
      icon={<Mic className="w-3.5 h-3.5" />}
      title="Microphone setup"
      subtitle="Choose the input device and check both voices can be heard"
      badge={badge}
    >
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <label
            htmlFor="mic-device-select"
            className="text-[10px] font-bold uppercase tracking-wider text-[#6b7685]"
          >
            Input device
          </label>
          <select
            id="mic-device-select"
            value={selectedDeviceId ?? SYSTEM_DEFAULT_VALUE}
            disabled={disabled}
            onChange={(e) =>
              onSelectDevice(e.target.value === SYSTEM_DEFAULT_VALUE ? undefined : e.target.value)
            }
            className="w-full bg-[#161a1e] border border-[rgba(255,255,255,0.07)] rounded-[6px] px-3 py-2.5 text-sm text-[#eef0f3] disabled:opacity-50"
          >
            <option value={SYSTEM_DEFAULT_VALUE}>System default</option>
            {devices.map((device) => (
              <option key={device.deviceId} value={device.deviceId}>
                {device.label}
              </option>
            ))}
          </select>
          <p className="text-xs text-[#6b7685] leading-relaxed">
            Place the device on the table between both people, angled toward whoever sits
            farther away — a laptop's built-in microphone array favors the person closest to it.
          </p>
          {fellBackToDefault && (
            <p className="text-xs text-amber-400 leading-relaxed">{DEVICE_FALLBACK_NOTICE}</p>
          )}
          {disabled && (
            <p className="text-xs text-[#6b7685] leading-relaxed">
              Locked while recording — stop to change the input device.
            </p>
          )}
        </div>
      </div>
    </CollapsibleSection>
  );
};
