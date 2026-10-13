import { Euler, MathUtils, Quaternion, Vector3 } from 'three';

type PermissionFn = () => Promise<'granted' | 'denied'>;

let permission: Promise<boolean> | null = null;

/**
 * iOS needs explicit permission for motion sensors, requested inside a user gesture.
 * Call synchronously from the start-button tap; later calls return the same answer.
 */
export function requestOrientationPermission(): Promise<boolean> {
  if (permission) return permission;
  const request = (globalThis.DeviceOrientationEvent as unknown as { requestPermission?: PermissionFn })?.requestPermission;
  permission =
    typeof request === 'function'
      ? request().then((r) => r === 'granted').catch(() => false)
      : Promise.resolve(typeof DeviceOrientationEvent !== 'undefined');
  return permission;
}

const zee = new Vector3(0, 0, 1);
const euler = new Euler();
const q0 = new Quaternion();
const q1 = new Quaternion(-Math.sqrt(0.5), 0, 0, Math.sqrt(0.5)); // -90° around X

/**
 * Phone orientation as a camera quaternion (camera looks out of the back of the phone, -Z),
 * in an arbitrary but fixed world frame. Same maths as three's former DeviceOrientationControls.
 */
export class DeviceOrientationSource {
  private alpha = 0;
  private beta = 0;
  private gamma = 0;
  private received = false;

  get hasData(): boolean {
    return this.received;
  }

  async start(): Promise<void> {
    if (!(await requestOrientationPermission())) return;
    window.addEventListener('deviceorientation', this.onEvent);
  }

  stop(): void {
    window.removeEventListener('deviceorientation', this.onEvent);
    this.received = false;
  }

  /** Writes the current camera orientation into `out`. Returns false without sensor data. */
  read(out: Quaternion): boolean {
    if (!this.received) return false;
    const orient = MathUtils.degToRad(screen.orientation?.angle ?? (window as unknown as { orientation?: number }).orientation ?? 0);
    euler.set(
      MathUtils.degToRad(this.beta),
      MathUtils.degToRad(this.alpha),
      -MathUtils.degToRad(this.gamma),
      'YXZ',
    );
    out.setFromEuler(euler);
    out.multiply(q1);
    out.multiply(q0.setFromAxisAngle(zee, -orient));
    return true;
  }

  private onEvent = (e: DeviceOrientationEvent): void => {
    if (e.alpha === null || e.beta === null || e.gamma === null) return;
    this.alpha = e.alpha;
    this.beta = e.beta;
    this.gamma = e.gamma;
    this.received = true;
  };
}
