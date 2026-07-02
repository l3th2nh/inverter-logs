#!/usr/bin/env python3
# ============================================================================
#  solis_emulator.py - Gia lap bien tan Solis S6 Hybrid (Modbus RTU slave)
# ============================================================================
#  Chay tren PC + USB-RS485 dongle (chip CH340, co cau dau A/B).
#  Dong vai "bien tan Solis that" tren bus RS485: mo cac input register (FC04)
#  o dung dia chi register map Solis, tra ve gia tri thuc te (co bien thien
#  theo thoi gian). ESP32 (firmware che do master) doc no nhu doc Solis that
#  -> validate toan bo chuoi giai ma + phan cung RS485, 0 rui ro bien tan.
#
#  Dau day:  USB-RS485 A  <-> XY-S485 A+ (cua ESP32) ;  B <-> B-
#  (2 node RS485 noi song song A-A, B-B; ESP32 la master, PC la slave.)
#
#  Cai dat:  pip install "pymodbus==3.5.4" pyserial
#  Chay:     python solis_emulator.py --port COM5
#            (xem COM nao: Device Manager, hoac: python -m serial.tools.list_ports)
#
#  Quy uoc PHAI khop firmware (config.h):
#   - Dia chi PDU = so_tai_lieu - 30001  (input register 0-based, offset 30001)
#   - So 32-bit: thanh ghi dia chi THAP = word CAO (REG32_LOW_ADDR_IS_HIGH_WORD=true)
# ============================================================================
import argparse
import math
import threading
import time

from pymodbus.datastore import (
    ModbusSequentialDataBlock,
    ModbusServerContext,
    ModbusSlaveContext,
)
from pymodbus.server import StartSerialServer
from pymodbus.transaction import ModbusRtuFramer

REG_OFFSET = 30001          # doc_reg - REG_OFFSET = dia chi PDU tren day
LOW_ADDR_IS_HIGH_WORD = True
FC_INPUT_REGISTERS = 4      # FC04

# --- Register map (khop firmware/src/config.h) ---
# (doc_reg, ten, count, kieu, scale)
U16, S16, U32, S32 = "U16", "S16", "U32", "S32"
REGISTERS = [
    (33139, "Battery SOC",          1, U16, 1.0),
    (33140, "Battery SOH",          1, U16, 1.0),
    (33133, "Battery Voltage",      1, U16, 0.1),
    (33134, "Battery Current",      1, S16, 0.1),
    (33149, "Battery Power",        2, S32, 1.0),
    (33257, "Grid/Meter Power",     2, S32, 1.0),
    (33282, "Meter Frequency",      1, U16, 0.01),
    (33049, "PV1 Voltage",          1, U16, 0.1),
    (33051, "PV2 Voltage",          1, U16, 0.1),
    (33057, "PV Power (DC total)",  2, S32, 1.0),
    (33147, "House Load Power",     1, U16, 1.0),
    (33151, "Inverter AC Power",    2, S32, 1.0),
    (33093, "Inverter Temperature", 1, S16, 0.1),
    (33035, "Daily Generation",     1, U16, 0.1),
    (33029, "Total Generation",     2, U32, 1.0),
    (33169, "Total Imported",       2, U32, 1.0),
    (33161, "Total Battery Charge", 2, U32, 1.0),
]
REG_BY_NAME = {name: (doc, cnt, typ, scale) for (doc, name, cnt, typ, scale) in REGISTERS}


def encode(reg_type, value, scale):
    """Ma hoa gia tri ky thuat -> list word 16-bit (word dia chi thap truoc)."""
    raw = int(round(value / scale))
    if reg_type == U16:
        return [raw & 0xFFFF]
    if reg_type == S16:
        return [raw & 0xFFFF]                      # bu 2 tu dong khi & 0xFFFF
    u = raw & 0xFFFFFFFF                            # U32 & S32 deu bu 2
    hi, lo = (u >> 16) & 0xFFFF, u & 0xFFFF
    return [hi, lo] if LOW_ADDR_IS_HIGH_WORD else [lo, hi]


def write_reg(slave_ctx, doc_reg, reg_type, scale, value):
    words = encode(reg_type, value, scale)
    addr = doc_reg - REG_OFFSET
    slave_ctx.setValues(FC_INPUT_REGISTERS, addr, words)


def snapshot(t):
    """Gia tri Solis 'song' theo thoi gian t (giay) - de thay so nhay tren ESP32."""
    # Nang mat troi theo 'nhip' (gia lap may bay qua), pin xa bu phan thieu.
    pv = max(0.0, 2200.0 + 900.0 * math.sin(t / 20.0))         # 1300..3100 W
    load = 700.0 + 150.0 * math.sin(t / 7.0)                   # ~550..850 W
    # Cong suat luoi = tai - pv - xa_pin. Am = ban ra, Duong = mua vao.
    batt_power = -600.0 if pv > load else 400.0                # xa khi du nang
    grid = load - pv - batt_power
    soc = 70.0 + 15.0 * math.sin(t / 120.0)                    # 55..85 %
    return {
        "Battery SOC": round(soc),
        "Battery SOH": 98,
        "Battery Voltage": 53.2,
        "Battery Current": -(batt_power / 53.2),
        "Battery Power": batt_power,
        "Grid/Meter Power": grid,
        "Meter Frequency": 50.0,
        "PV1 Voltage": 310.0,
        "PV2 Voltage": 305.0,
        "PV Power (DC total)": pv,
        "House Load Power": load,
        "Inverter AC Power": max(0.0, pv + max(0.0, -batt_power) - 50.0),
        "Inverter Temperature": 35.0 + pv / 500.0,
        "Daily Generation": 12.3,
        "Total Generation": 8421.0,
        "Total Imported": 1503.0,
        "Total Battery Charge": 2044.0,
    }


def updater(context, slave_id, stop):
    """Cap nhat register moi giay + in ra man hinh de doi chieu voi ESP32."""
    slave_ctx = context[slave_id]
    t = 0.0
    while not stop.is_set():
        vals = snapshot(t)
        for name, v in vals.items():
            doc, cnt, typ, scale = REG_BY_NAME[name]
            write_reg(slave_ctx, doc, typ, scale, v)
        print(f"[t={int(t):4d}s] SOC={vals['Battery SOC']}%  "
              f"PV={vals['PV Power (DC total)']:.0f}W  "
              f"Grid={vals['Grid/Meter Power']:.0f}W  "
              f"Batt={vals['Battery Power']:.0f}W  "
              f"Load={vals['House Load Power']:.0f}W")
        time.sleep(1.0)
        t += 1.0


def main():
    ap = argparse.ArgumentParser(description="Gia lap bien tan Solis (Modbus RTU slave)")
    ap.add_argument("--port", required=True, help="COM cua USB-RS485, vd COM5 hoac /dev/ttyUSB0")
    ap.add_argument("--baud", type=int, default=9600)
    ap.add_argument("--slave", type=int, default=1, help="Modbus slave ID (mac dinh 1)")
    args = ap.parse_args()

    # Khoi 3400 input register (dat het register map), zero_mode -> index == dia chi PDU.
    block = ModbusSequentialDataBlock(0, [0] * 3400)
    slave = ModbusSlaveContext(ir=block, zero_mode=True)
    context = ModbusServerContext(slaves={args.slave: slave}, single=False)

    stop = threading.Event()
    th = threading.Thread(target=updater, args=(context, args.slave, stop), daemon=True)
    th.start()

    print(f"Solis emulator: port={args.port} baud={args.baud} slave={args.slave}")
    print("Bam Ctrl+C de dung.\n")
    try:
        StartSerialServer(
            context=context,
            framer=ModbusRtuFramer,
            port=args.port,
            baudrate=args.baud,
            bytesize=8, parity="N", stopbits=1,
        )
    except KeyboardInterrupt:
        pass
    finally:
        stop.set()
        print("\nDa dung emulator.")


if __name__ == "__main__":
    main()
