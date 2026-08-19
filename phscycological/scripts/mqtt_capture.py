#!/usr/bin/env python3
"""
Capture raw EEG readings from the live MQTT stream to a CSV file -- for the
bench verification tests (scripts/adc_bench_verify.py) and for general
debugging/logging of what the device is actually sending.

Prints a live running sample count every second (not just a total at the
end), so you can see immediately whether anything is arriving at all
instead of waiting out the full --duration to find out.

Usage:
    python3 scripts/mqtt_capture.py --broker 192.168.1.4 --duration 10 --out short_test.csv
"""

import argparse
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'src'))

from realtime.adc import code_to_microvolts  # noqa: E402
from realtime.mqtt_client import RawSampleBuffer, make_client  # noqa: E402


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--broker', default='192.168.1.2')
    parser.add_argument('--port', type=int, default=1883)
    parser.add_argument('--topic', default='eeg/t7t8/raw')
    parser.add_argument('--duration', type=float, required=True, help='Seconds to capture')
    parser.add_argument('--out', required=True, help='Output CSV path')
    args = parser.parse_args()

    buffer = RawSampleBuffer()
    client = make_client(args.broker, args.port, args.topic, buffer)
    client.loop_start()

    print(f'Capturing for {args.duration:.0f}s from {args.broker}:{args.port}/{args.topic}...')
    start = time.time()
    last_count = 0
    while time.time() - start < args.duration:
        time.sleep(1)
        n = buffer.peek_count()
        elapsed = time.time() - start
        rate = (n - last_count)  # samples in the last ~1s, a live rate indicator
        print(f'  t={elapsed:4.1f}s  total_samples={n:6d}  (+{rate}/s, firmware targets ~250/s)')
        last_count = n

    client.loop_stop()
    client.disconnect()

    samples = buffer.drain(buffer.peek_count())
    if not samples:
        print('\nWARNING: captured 0 samples for the entire duration. Nothing is reaching this '
              'script via MQTT -- check (in order): is the broker actually running and reachable '
              '(try `mosquitto_sub -h <broker> -t eeg/t7t8/raw -v` directly), is the ESP32 powered '
              'on and past setup() (check its Serial monitor for \'ADS STREAMING\'), does '
              'MQTT_BROKER in the firmware match this machine\'s actual IP, and is DRDY actually '
              'toggling (a WRITE FAIL REG during ADS1292R init means DRDY will never fire and '
              'nothing will ever publish, even with a perfect WiFi/MQTT connection).')
        return

    out_path = Path(args.out)
    with out_path.open('w') as f:
        f.write('millis,ch1_code,ch2_code,ch1_uv,ch2_uv\n')
        for s in samples:
            ch1_uv = code_to_microvolts(s.ch1_code)
            ch2_uv = code_to_microvolts(s.ch2_code)
            f.write(f'{s.millis},{s.ch1_code},{s.ch2_code},{ch1_uv:.3f},{ch2_uv:.3f}\n')

    print(f'\nWrote {len(samples)} rows -> {out_path} '
          f'(implied rate: {len(samples) / args.duration:.1f} samples/sec, firmware targets 250)')


if __name__ == '__main__':
    main()
