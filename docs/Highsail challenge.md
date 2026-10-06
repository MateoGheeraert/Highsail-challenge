
# **Live Voice Form Filler**

**Role:** Full-stack engineer

**Timebox:** 4–6 hours (stretch goals optional)

**Format:** Greenfield app, any stack you like. No existing codebase.

---

## Product brief

Build **Formcast**: a small mobile **expo react native app** where a field technician fills a structured job form by **speaking continuously**. While they talk, the UI shows a **live preview of what would be saved if they stopped now**. Nothing is written to the database until they press **Finish**.

This is **not** “record → upload → wait → extract.” Audio must be streamed (or chunked at short intervals) so the model can update proposals in near real time.

---

## Domain (invented for this challenge)

A **Job** has a form made of:

### 1. Fields (scalar)

Typed values on the job itself, e.g.:

- `arrivalTime` (time)
- `distanceKm` (number)
- `generalRemarks` (free text)
- `jobComplete` (boolean)
- `priority` (single select) e.g. `low` | `medium` | `high`
- `tags` (multi select) e.g. `urgent`, `warranty`, `follow-up`, `parts-needed`

### 2. Line items (repeating rows)

One or more named groups that allow multiple rows, e.g. **Materials used**:

|material (free text)|quantity (number)|unit (single select)|
|---|---|---|
|Cable|12|m|
|Screws|40|pcs|

Each group has a fixed schema (column definitions). Rows can be created, updated, or deleted via speech. To complete a row, the minimum necessary fields need to be present.

Seed the app with **one demo job** and a fixed form schema (hardcoded is fine). No need for a form builder.

---

## Core UX (must work)

1. User opens a job → sees empty/partially filled form.
2. Presses **Start speaking** → mic streams to your backend → LLM continuously updates a **proposal state**.
3. UI shows, for every proposed change:
    - which field / which line
    - create / update / delete
    - the proposed value (visually distinct from committed values, e.g. dashed border, amber highlight, “proposed” badge)
4. Speech corrections update proposals live:
    - _“I arrived at 11am”_ → propose `arrivalTime = 11:00`
    - _“No scrap that”_ → clear that proposal
    - _“It was 10am”_ → propose `arrivalTime = 10:00`
5. Same for lines:
    - _“Used 12 meters of cable”_ → propose create materials row
    - _“Make that 15 meters”_ → update the proposed (or existing) row
    - _“Forget the cable”_ → propose delete / remove proposal
6. **Finish** → persist proposals to DB, clear proposal layer, show committed values.
7. **Cancel** → discard proposals, leave DB unchanged.

While speaking, the UI should feel like: _“this is what will be saved if you stop talking now.”_

---

## Functional requirements

### Must have

- [ ] Live (or near-live) audio → model pipeline (not a single post-recording batch)
- [ ] Proposal state separate from persisted state
- [ ] Field CRUD via speech: set / change / clear
- [ ] Line CRUD via speech: create / update / delete
- [ ] Live UI reflecting current proposals during speech
- [ ] Finish commits; Cancel discards
- [ ] Persist jobs, fields, and lines in a real database
- [ ] Basic error / empty-mic handling

### Nice to have (stretch)

- Partial transcripts shown while speaking
- Confidence / “model is thinking” indicator
- Undo last proposal
- Multi-turn consistency when the user revises earlier statements
- Auth (even a single hardcoded user is fine if you skip this)

### Out of scope

- Multi-tenant orgs, roles, permissions
- Form/schema builder UI
- Perfect ASR accuracy, correctness of the **proposal plumbing** matters more than STT quality
- Production hardening (queues, retries, observability) beyond what’s needed to demo

---

## Example script (use this in your demo)

Form fields: Arrival time, Distance travelled, General remarks

Lines: Materials (material, quantity, unit)

|User says|Expected UI||
|---|---|---|
|“I arrived at 11am”|Arrival time proposed as **11:00**||
|“No scrap that”|Proposal removed; field empty again||
|“It was 10am”|Arrival time proposed as **10:00**||
|“I drove about 42 kilometers”|Distance proposed as **42**||
|“Used twelve meters of cable and forty screws”|Two material rows proposed||
|“Actually make the cable fifteen meters”|Cable row quantity → **15**||
|“Forget the screws”|Screws row proposal removed / delete proposed||
|_Press Finish_|All remaining proposals saved to DB||
|“Set priority to high”|Priority proposed as **high**||
|“Tag this as warranty and follow-up”|Tags proposed as **warranty**, **follow-up**||
|“Remove the follow-up tag”|Tags proposed as **warranty** only||

---

## What we’re evaluating

| Area                    | Looking for                                                         |
| ----------------------- | ------------------------------------------------------------------- |
| **Architecture**        | Clear split: streaming audio → inference → proposal store → commit  |
| **Data model**          | Fields vs lines; proposed vs committed; create/update/delete ops    |
| **Realtime UX**         | UI stays coherent as speech revises earlier intents                 |
| **LLM integration**     | Structured output the UI can apply; handling corrections/negations  |
| **Full-stack judgment** | Sensible API design, persistence, and tradeoffs under time pressure |
| **Clarity**             | README with setup, design notes, and known limitations              |

We care more about a **correct mental model and working demo** than polish or perfect ASR.

---

## Deliverables

1. We will do a short google meet where you can walk through the project, do a short demo and answer some questions.
2. Public GitHub repo (or zip) with a README:
    - Architecture sketch (short)
    - Tradeoffs you made (streaming strategy, model, proposal sync)
    - What you’d do with another day

---

## Suggested tech (optional, pick what you’re fast with)

- **Mobile App**: Expo React Native
- **Backend:** Node, Python, whatever works best for you
- **DB:** Postgres, SQLite, or similar
- **Audio:** Livekit, Elevenlabs real time, custom pipeline, you can do whatever here
- **LLM:** Anything you think is best for the job

---

## Hints (not prescriptions)

1. Treat **proposals as a patch list** over the current form snapshot, not as mutating the DB early.
2. Model output should be structured ops, e.g.:

```json
{
  fieldOps: [
    { 
	    op: "set" | "clear", 
	    fieldKey: string, 
	    value?: unknown 
    }
  ],
  lineOps: [
    { 
	    op: "create" | "update" | "delete", 
	    groupKey: string, 
	    lineId?: string, 
	    values?: Record<string, unknown> 
	  }
  ]
}
```

1. The hard part is **revision**: “scrap that” / “make that X” must update or remove earlier proposals, not only append.
2. Prefer a reliable 1–2s proposal refresh over a fragile fully-duplex setup if time is short, but it must feel live, not “wait until I hang up.”