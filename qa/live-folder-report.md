# Live Folder Validation

> Archived explicit-action result from before the compact batch planner. It is
> retained as historical evidence and does not claim that the current planner
> was model-tested; the user requested no additional credit-using model tests.

Generated: 2026-08-02T19:50:31.200Z
Model: `qwen2.5-coder:14b`
Result: **3/3 passed**

These are behavioral assertions over actual local-model output. The application does not reuse these answers.

## Sort request — PASS

The model produced a schema-valid, reviewable proposal using only real inventory source paths.

```text
Sure, I can help organize the files into sensible category subfolders based on their types. Here's a proposal:

```json
{
  "actions": [
    {
      "type": "createFolder",
      "path": "Documents"
    },
    {
      "type": "move",
      "from": "loose-notes.txt",
      "to": "Documents/loose-notes.txt"
    },
    {
      "type": "move",
      "from": "draft.md",
      "to": "Documents/draft.md"
    },
    {
      "type": "createFolder",
      "path": "Receipts"
    },
    {
      "type": "move",
      "from": "receipt-january.pdf",
      "to": "Receipts/receipt-january.pdf"
    },
    {
      "type": "createFolder",
      "path": "Photos"
    },
    {
      "type": "move",
      "from": "vacation-photo.jpg",
      "to": "Photos/vacation-photo.jpg"
    }
  ],
  "reasoning": "Organizing files into category subfolders based on their types (Documents, Receipts, Photos) for better management."
}
```
```

## 72-song organization request — PASS

The model proposed 72 grounded song moves in a reviewable plan without reading binary audio or using wildcards.

```text
```json
{
  "actions": [
    {
      "type": "move",
      "from": "Aurora Vale - 01 - Track 01.mp3",
      "to": "Aurora Vale/Aurora Vale - 01 - Track 01.mp3"
    },
    {
      "type": "move",
      "from": "Aurora Vale - 02 - Track 02.mp3",
      "to": "Aurora Vale/Aurora Vale - 02 - Track 02.mp3"
    },
    {
      "type": "move",
      "from": "Aurora Vale - 03 - Track 03.mp3",
      "to": "Aurora Vale/Aurora Vale - 03 - Track 03.mp3"
    },
    {
      "type": "move",
      "from": "Aurora Vale - 04 - Track 04.mp3",
      "to": "Aurora Vale/Aurora Vale - 04 - Track 04.mp3"
    },
    {
      "type": "move",
      "from": "Aurora Vale - 05 - Track 05.mp3",
      "to": "Aurora Vale/Aurora Vale - 05 - Track 05.mp3"
    },
    {
      "type": "move",
      "from": "Aurora Vale - 06 - Track 06.mp3",
      "to": "Aurora Vale/Aurora Vale - 06 - Track 06.mp3"
    },
    {
      "type": "move",
      "from": "Aurora Vale - 07 - Track 07.mp3",
      "to": "Aurora Vale/Aurora Vale - 07 - Track 07.mp3"
    },
    {
      "type": "move",
      "from": "Aurora Vale - 08 - Track 08.mp3",
      "to": "Aurora Vale/Aurora Vale - 08 - Track 08.mp3"
    },
    {
      "type": "move",
      "from": "Aurora Vale - 09 - Track 09.mp3",
      "to": "Aurora Vale/Aurora Vale - 09 - Track 09.mp3"
    },
    {
      "type": "move",
      "from": "Aurora Vale - 10 - Track 10.mp3",
      "to": "Aurora Vale/Aurora Vale - 10 - Track 10.mp3"
    },
    {
      "type": "move",
      "from": "Aurora Vale - 11 - Track 11.mp3",
      "to": "Aurora Vale/Aurora Vale - 11 - Track 11.mp3"
    },
    {
      "type": "move",
      "from": "Aurora Vale - 12 - Track 12.mp3",
      "to": "Aurora Vale/Aurora Vale - 12 - Track 12.mp3"
    },
    {
      "type": "move",
      "from": "Copper Static - 01 - Track 01.mp3",
      "to": "Copper Static/Copper Static - 01 - Track 01.mp3"
    },
    {
      "type": "move",
      "from": "Copper Static - 02 - Track 02.mp3",
      "to": "Copper Static/Copper Static - 02 - Track 02.mp3"
    },
    {
      "type": "move",
      "from": "Copper Static - 03 - Track 03.mp3",
      "to": "Copper Static/Copper Static - 03 - Track 03.mp3"
    },
    {
      "type": "move",
      "from": "Copper Static - 04 - Track 04.mp3",
      "to": "Copper Static/Copper Static - 04 - Track 04.mp3"
    },
    {
      "type": "move",
      "from": "Copper Static - 05 - Track 05.mp3",
      "to": "Copper Static/Copper Static - 05 - Track 05.mp3"
    },
    {
      "type": "move",
      "from": "Copper Static - 06 - Track 06.mp3",
      "to": "Copper Static/Copper Static - 06 - Track 06.mp3"
    },
    {
      "type": "move",
      "from": "Copper Static - 07 - Track 07.mp3",
      "to": "Copper Static/Copper Static - 07 - Track 07.mp3"
    },
    {
      "type": "move",
      "from": "Copper Static - 08 - Track 08.mp3",
      "to": "Copper Static/Copper Static - 08 - Track 08.mp3"
    },
    {
      "type": "move",
      "from": "Copper Static - 09 - Track 09.mp3",
      "to": "Copper Static/Copper Static - 09 - Track 09.mp3"
    },
    {
      "type": "move",
      "from": "Copper Static - 10 - Track 10.mp3",
      "to": "Copper Static/Copper Static - 10 - Track 10.mp3"
    },
    {
      "type": "move",
      "from": "Copper Static - 11 - Track 11.mp3",
      "to": "Copper Static/Copper Static - 11 - Track 11.mp3"
    },
    {
      "type": "move",
      "from": "Copper Static - 12 - Track 12.mp3",
      "to": "Copper Static/Copper Static - 12 - Track 12.mp3"
    },
    {
      "type": "move",
      "from": "Juniper Sky - 01 - Track 01.mp3",
      "to": "Juniper Sky/Juniper Sky - 01 - Track 01.mp3"
    },
    {
      "type": "move",
      "from": "Juniper Sky - 02 - Track 02.mp3",
      "to": "Juniper Sky/Juniper Sky - 02 - Track 02.mp3"
    },
    {
      "type": "move",
      "from": "Juniper Sky - 03 - Track 03.mp3",
      "to": "Juniper Sky/Juniper Sky - 03 - Track 03.mp3"
    },
    {
      "type": "move",
      "from": "Juniper Sky - 04 - Track 04.mp3",
      "to": "Juniper Sky/Juniper Sky - 04 - Track 04.mp3"
    },
    {
      "type": "move",
      "from": "Juniper Sky - 05 - Track 05.mp3",
      "to": "Juniper Sky/Juniper Sky - 05 - Track 05.mp3"
    },
    {
      "type": "move",
      "from": "Juniper Sky - 06 - Track 06.mp3",
      "to": "Juniper Sky/Juniper Sky - 06 - Track 06.mp3"
    },
    {
      "type": "move",
      "from": "Juniper Sky - 07 - Track 07.mp3",
      "to": "Juniper Sky/Juniper Sky - 07 - Track 07.mp3"
    },
    {
      "type": "move",
      "from": "Juniper Sky - 08 - Track 08.mp3",
      "to": "Juniper Sky/Juniper Sky - 08 - Track 08.mp3"
    },
    {
      "type": "move",
      "from": "Juniper Sky - 09 - Track 09.mp3",
      "to": "Juniper Sky/Juniper Sky - 09 - Track 09.mp3"
    },
    {
      "type": "move",
      "from": "Juniper Sky - 10 - Track 10.mp3",
      "to": "Juniper Sky/Juniper Sky - 10 - Track 10.mp3"
    },
    {
      "type": "move",
      "from": "Juniper Sky - 11 - Track 11.mp3",
      "to": "Juniper Sky/Juniper Sky - 11 - Track 11.mp3"
    },
    {
      "type": "move",
      "from": "Juniper Sky - 12 - Track 12.mp3",
      "to": "Juniper Sky/Juniper Sky - 12 - Track 12.mp3"
    },
    {
      "type": "move",
      "from": "Midnight Relay - 01 - Track 01.mp3",
      "to": "Midnight Relay/Midnight Relay - 01 - Track 01.mp3"
    },
    {
      "type": "move",
      "from": "Midnight Relay - 02 - Track 02.mp3",
      "to": "Midnight Relay/Midnight Relay - 02 - Track 02.mp3"
    },
    {
      "type": "move",
      "from": "Midnight Relay - 03 - Track 03.mp3",
      "to": "Midnight Relay/Midnight Relay - 03 - Track 03.mp3"
    },
    {
      "type": "move",
      "from": "Midnight Relay - 04 - Track 04.mp3",
      "to": "Midnight Relay/Midnight Relay - 04 - Track 04.mp3"
    },
    {
      "type": "move",
      "from": "Midnight Relay - 05 - Track 05.mp3",
      "to": "Midnight Relay/Midnight Relay - 05 - Track 05.mp3"
    },
    {
      "type": "move",
      "from": "Midnight Relay - 06 - Track 06.mp3",
      "to": "Midnight Relay/Midnight Relay - 06 - Track 06.mp3"
    },
    {
      "type": "move",
      "from": "Midnight Relay - 07 - Track 07.mp3",
      "to": "Midnight Relay/Midnight Relay - 07 - Track 07.mp3"
    },
    {
      "type": "move",
      "from": "Midnight Relay - 08 - Track 08.mp3",
      "to": "Midnight Relay/Midnight Relay - 08 - Track 08.mp3"
    },
    {
      "type": "move",
      "from": "Midnight Relay - 09 - Track 09.mp3",
      "to": "Midnight Relay/Midnight Relay - 09 - Track 09.mp3"
    },
    {
      "type": "move",
      "from": "Midnight Relay - 10 - Track 10.mp3",
      "to": "Midnight Relay/Midnight Relay - 10 - Track 10.mp3"
    },
    {
      "type": "move",
      "from": "Midnight Relay - 11 - Track 11.mp3",
      "to": "Midnight Relay/Midnight Relay - 11 - Track 11.mp3"
    },
    {
      "type": "move",
      "from": "Midnight Relay - 12 - Track 12.mp3",
      "to": "Midnight Relay/Midnight Relay - 12 - Track 12.mp3"
    },
    {
      "type": "move",
      "from": "Paper Satellites - 01 - Track 01.mp3",
      "to": "Paper Satellites/Paper Satellites - 01 - Track 01.mp3"
    },
    {
      "type": "move",
      "from": "Paper Satellites - 02 - Track 02.mp3",
      "to": "Paper Satellites/Paper Satellites - 02 - Track 02.mp3"
    },
    {
      "type": "move",
      "from": "Paper Satellites - 03 - Track 03.mp3",
      "to": "Paper Satellites/Paper Satellites - 03 - Track 03.mp3"
    },
    {
      "type": "move",
      "from": "Paper Satellites - 04 - Track 04.mp3",
      "to": "Paper Satellites/Paper Satellites - 04 - Track 04.mp3"
    },
    {
      "type": "move",
      "from": "Paper Satellites - 05 - Track 05.mp3",
      "to": "Paper Satellites/Paper Satellites - 05 - Track 05.mp3"
    },
    {
      "type": "move",
      "from": "Paper Satellites - 06 - Track 06.mp3",
      "to": "Paper Satellites/Paper Satellites - 06 - Track 06.mp3"
    },
    {
      "type": "move",
      "from": "Paper Satellites - 07 - Track 07.mp3",
      "to": "Paper Satellites/Paper Satellites - 07 - Track 07.mp3"
    },
    {
      "type": "move",
      "from": "Paper Satellites - 08 - Track 08.mp3",
      "to": "Paper Satellites/Paper Satellites - 08 - Track 08.mp3"
    },
    {
      "type": "move",
      "from": "Paper Satellites - 09 - Track 09.mp3",
      "to": "Paper Satellites/Paper Satellites - 09 - Track 09.mp3"
    },
    {
      "type": "move",
      "from": "Paper Satellites - 10 - Track 10.mp3",
      "to": "Paper Satellites/Paper Satellites - 10 - Track 10.mp3"
    },
    {
      "type": "move",
      "from": "Paper Satellites - 11 - Track 11.mp3",
      "to": "Paper Satellites/Paper Satellites - 11 - Track 11.mp3"
    },
    {
      "type": "move",
      "from": "Paper Satellites - 12 - Track 12.mp3",
      "to": "Paper Satellites/Paper Satellites - 12 - Track 12.mp3"
    },
    {
      "type": "move",
      "from": "Velvet Circuit - 01 - Track 01.mp3",
      "to": "Velvet Circuit/Velvet Circuit - 01 - Track 01.mp3"
    },
    {
      "type": "move",
      "from": "Velvet Circuit - 02 - Track 02.mp3",
      "to": "Velvet Circuit/Velvet Circuit - 02 - Track 02.mp3"
    },
    {
      "type": "move",
      "from": "Velvet Circuit - 03 - Track 03.mp3",
      "to": "Velvet Circuit/Velvet Circuit - 03 - Track 03.mp3"
    },
    {
      "type": "move",
      "from": "Velvet Circuit - 04 - Track 04.mp3",
      "to": "Velvet Circuit/Velvet Circuit - 04 - Track 04.mp3"
    },
    {
      "type": "move",
      "from": "Velvet Circuit - 05 - Track 05.mp3",
      "to": "Velvet Circuit/Velvet Circuit - 05 - Track 05.mp3"
    },
    {
      "type": "move",
      "from": "Velvet Circuit - 06 - Track 06.mp3",
      "to": "Velvet Circuit/Velvet Circuit - 06 - Track 06.mp3"
    },
    {
      "type": "move",
      "from": "Velvet Circuit - 07 - Track 07.mp3",
      "to": "Velvet Circuit/Velvet Circuit - 07 - Track 07.mp3"
    },
    {
      "type": "move",
      "from": "Velvet Circuit - 08 - Track 08.mp3",
      "to": "Velvet Circuit/Velvet Circuit - 08 - Track 08.mp3"
    },
    {
      "type": "move",
      "from": "Velvet Circuit - 09 - Track 09.mp3",
      "to": "Velvet Circuit/Velvet Circuit - 09 - Track 09.mp3"
    },
    {
      "type": "move",
      "from": "Velvet Circuit - 10 - Track 10.mp3",
      "to": "Velvet Circuit/Velvet Circuit - 10 - Track 10.mp3"
    },
    {
      "type": "move",
      "from": "Velvet Circuit - 11 - Track 11.mp3",
      "to": "Velvet Circuit/Velvet Circuit - 11 - Track 11.mp3"
    },
    {
      "type": "move",
      "from": "Velvet Circuit - 12 - Track 12.mp3",
      "to": "Velvet Circuit/Velvet Circuit - 12 - Track 12.mp3"
    }
  ],
  "reasoning": "Organizing the songs by artist involves creating a folder for each artist and moving their respective tracks into those folders while preserving the original filenames."
}
```
```

## Selective file read — PASS

Selected paths across at most two rounds: ["src/services/endpoint.ts"]
