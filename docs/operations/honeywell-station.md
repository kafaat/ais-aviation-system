# Honeywell boarding pass and baggage tag station

The Windows station client requests a document from the existing AIS kiosk API
and sends one EPL job to a local Windows share. Run commissioning on isolated
test stock using a checked-in test passenger and a registered bag eligible for
reprint on the same flight. The browser print dialog is a separate entry point.

| AIS document       | Local share | Printed symbol                                          | Minimum printable area for this profile |
| ------------------ | ----------- | ------------------------------------------------------- | --------------------------------------- |
| Boarding pass      | `HWBP`      | PDF417 containing the exact signed AIS BCBP             | 640 × 410 dots                          |
| Registered bag tag | `HWBT`      | Interleaved 2 of 5 containing all ten registered digits | 400 × 300 dots                          |

## Prepare the station

1. Install Honeywell InterDriver on the Windows workstation. Connect each
   PC42t or PC43d by USB when the wizard asks. Leave Generic/Text-Only mode
   unchecked. Give the boarding pass printer the local share name `HWBP` and
   the baggage printer `HWBT`. Grant the station account permission to print.
2. Check both physical devices, their Windows ports, stock, calibration, and
   firmware command language (ESim/EPL). Begin with a 203 dpi head and stock
   meeting the printable areas above. On a 300 dpi head the same dot coordinates
   give smaller symbols. Qualify each head, stock and reader combination.
3. Install Python 3.12 for Windows. Copy `scripts/station/honeywell.py` and
   `win_spool.py` together, or run from this checkout. Use one dedicated Windows
   account on the station. Its persistent journal lives in
   `%LOCALAPPDATA%\AIS\HoneywellStation\receipts.sqlite`.
4. Set the station's trusted AIS origin in PowerShell. Replace the example
   host and IDs below with the intended test deployment, passenger and active
   booked flight. Windows must trust the HTTPS certificate.

```powershell
$env:AIS_STATION_ORIGIN = 'https://ais.example.test'
Get-Printer | Where-Object ShareName -in 'HWBP','HWBT' |
  Format-Table Name,ShareName,PortName,DriverName
py -3.12 scripts/station/honeywell.py boarding-pass --passenger-id 3 --flight-id 21
py -3.12 scripts/station/honeywell.py bag-tag --passenger-id 3 --flight-id 21
```

The client prompts for the booking reference or PNR and surname. For a bag it
also asks for the exact registered ten-digit tag. The API authorizes the
passenger and sector and supplies the barcode. Keep the booking and scanner
input out of shell history. The print commands do not change baggage custody,
boarding status or server print counters.

## Verify the paper and the failure path

1. Retain each local receipt number. Check that the correct physical printer
   produced exactly one document on its intended stock. Inspect alignment,
   legibility and the route. Compare the boarding pass to the passenger and seat.
2. With a separate reader in keyboard mode, scan the **paper** at the corresponding
   prompt below. Configure the scanner to send the complete payload with a single
   Enter terminator. Disable symbology prefixes and preserve spaces, case and
   leading zeroes. Use the actual receipt numbers.

   ```powershell
   py -3.12 scripts/station/honeywell.py scan 1
   py -3.12 scripts/station/honeywell.py scan 2
   py -3.12 scripts/station/honeywell.py status 1
   ```

3. On a fresh fixture, disconnect one printer before sending. Windows may queue
   the job while the printer is offline. Check the queue and the paper before
   reconnecting. Repeat the same request from the same station account and
   verify that no second job is submitted. Reconnect under observation and
   reconcile the original job.
4. Record station, model, firmware, port, media, reader, UTC time, Windows
   job ID, observed output and scan result for each printer. Protect any records
   that contain a boarding credential. Obtain station acceptance before live use.

`queuedUtc` records completion of the Windows spool calls. A missing queued time
after an attempt means that the outcome needs investigation. Use the document
name `AIS station <receipt>` to find the job even if its ID was not persisted.
`operatorScanMatchedUtc` records an exact comparison with local scanner input.
The operator must witness the source of that input. Neither field is an
authenticated hardware acknowledgement sent to AIS. Anti-duplication applies
within this station journal. Preserve it across restarts and coordinate reissues
at the desk. Do not move to another account or delete receipts to force a retry.

The Windows CI job sends both documents to temporary file-backed printer ports
and compares the RAW bytes for each share. That test does not exercise the USB
devices, EPL firmware, print stock or an airport reader.

[Honeywell ESim command reference](https://prod-edam.honeywell.com/content/dam/honeywell-edam/sps/ppr/it-it/public/products/printers/common/documents/sps-ppr-937-024.pdf) · [Windows RAW spooling](https://learn.microsoft.com/en-us/windows/win32/printdocs/sending-data-directly-to-a-printer)
