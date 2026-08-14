import paho.mqtt.client as mqtt
import matplotlib.pyplot as plt
from collections import deque
import csv
import time
import os

# ---------- SETTINGS ----------

BROKER = "192.168.1.2"
TOPIC = "eeg/t7t8/raw"

BUFFER_SIZE = 500
SAVE_PLOT_EVERY = 10      # seconds

# ---------- BUFFERS ----------

buffer_ch1 = deque(maxlen=BUFFER_SIZE)
buffer_ch2 = deque(maxlen=BUFFER_SIZE)

# ---------- FILES ----------

session_time = time.strftime("%Y%m%d_%H%M%S")

csv_file = f"eeg_session_{session_time}.csv"

plot_folder = "plots"
os.makedirs(plot_folder, exist_ok=True)

# create CSV header
with open(csv_file, "w", newline="") as f:
    writer = csv.writer(f)
    writer.writerow(["timestamp_ms", "ch1", "ch2"])

last_plot_save = time.time()

# ---------- MQTT CALLBACK ----------

def on_message(client, userdata, msg):
    try:
        global last_plot_save

        data = msg.payload.decode().strip()

        ts, ch1, ch2 = data.split(",")

        ch1 = int(ch1)
        ch2 = int(ch2)

        # append for live plotting
        buffer_ch1.append(ch1)
        buffer_ch2.append(ch2)

        # save raw data immediately
        with open(csv_file, "a", newline="") as f:
            writer = csv.writer(f)
            writer.writerow([ts, ch1, ch2])

    except Exception as e:
        print("PARSE ERROR:", e)

# ---------- MQTT ----------

client = mqtt.Client(mqtt.CallbackAPIVersion.VERSION2)
client.on_message = on_message

client.connect(BROKER, 1883, 60)
client.subscribe(TOPIC)
client.loop_start()

print("Recording EEG...")
print("Saving CSV:", csv_file)

# ---------- PLOT ----------

plt.ion()

fig, ax = plt.subplots()

while True:

    if len(buffer_ch1) > 20:

        ax.clear()

        ax.plot(list(buffer_ch1), label="CH1 (T7)")
        ax.plot(list(buffer_ch2), label="CH2 (T8)")

        ax.set_title("Live EEG Recording")
        ax.legend()

        plt.pause(0.02)

        # save periodic plot snapshot
        now = time.time()

        if now - last_plot_save > SAVE_PLOT_EVERY:

            filename = (
                f"{plot_folder}/plot_"
                + time.strftime("%H%M%S")
                + ".png"
            )

            plt.savefig(filename)

            print("Saved plot:", filename)

            last_plot_save = now
