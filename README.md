# SC - Venaerys's Initiative

Phased initiative for Foundry VTT v13 and v14. Instead of one turn at a time, combat runs in **phases**:

- Characters roll against a **DC** set by the GM (or worked out as a base plus the enemies' CR): their system's own initiative roll by default, or a formula the GM sets (dice plus an attribute). Those who meet it act in **Fast**, the rest in **Slow**. By default a natural 20 (the system's critical) always acts in Fast and a natural 1 in Slow.
- Enemies don't roll: they act together in **Enemies**, between Fast and Slow.
- Everyone in a phase acts **at the same time**, each with a full normal turn. Each one marks **Done**; when everybody in the phase is done, the combat moves on to the next phase by itself.
- The GM adds extra phases (Epic Boss, Boss, Mini-Boss, or any other) and drags them before, between or after the players' phases. **Event phases** such as Lair Actions only happen in combats where the GM adds an event marker to them. Who is the boss is decided per combat, right in the combat tracker; an enemy with an item named exactly like a phase (a feature called "Boss", for example) starts in that phase.

Everything happens in Foundry's own Combat Tracker (sidebar and popout): in a phased combat it shows the phases, who is done and, for the GM, the phase controls. Foundry keeps seeing a normal combat, and with phases turned off the tracker and the combat are exactly Foundry's.

## Using it

1. Create a combat as usual. New combats use phases by default (a world setting); before the combat starts, the GM can switch phases on or off at the top of the combat tracker.
2. Players roll: a window asks them when their character joins a phased combat, and the tracker shows a **Roll** button on everyone still waiting (each player can turn the window off in their client settings). The GM can roll for anyone, or use **Roll for them** for everyone still waiting.
3. Set the DC at the top of the tracker and start the combat. If someone has not rolled and starting now would skip the players' first phase, the GM is asked first.
4. Mark **Done** when your turn is over. A player's "End turn" in the tracker does the same; the GM's "Next turn" and "Previous turn" become "Next phase" and "Previous phase".

When a phased combat starts, the combat tab comes forward on every client (a per-user setting).

### For the GM

- **Next phase** advances even if someone hasn't marked Done. **Complete phase** marks everyone in the current phase done and advances. **Previous phase** goes back and keeps the marks; automatic advance then waits for the next mark in that phase.
- Move a combatant to another phase with the select on its row, by dragging the row onto another phase, or with **Move to phase…** in its right-click menu. The move pins them to that phase for this combat only ("Automatic" goes back to the rules). Moves never take a turn away or give an extra one: someone who already acted moves next round.
- An enemy whose actor has an item named exactly like a creature phase (ignoring case) enters in that phase, the earliest one if several match, without being pinned; "Automatic" goes back to it. The name is the phase's name as the GM sees it, so a renamed or translated phase needs the item renamed too.
- An hourglass marks the member that Foundry treats as the current turn: only they get the system's end-of-turn automation, when the phase ends.
- With the DC set to **Base + CR**, the DC follows the enemies until the combat starts and then stays put; the calculator button next to the DC recalculates it at any time. A DC typed by hand stays as typed.
- **Skip this round** on a combatant of a later phase (surprise, stunned) marks them done in advance.
- With **Movement and actions** on (World tab: players' phases, or every creature phase), each of those phases runs in two halves: **Fast · Movement**, where everyone moves and marks **Moved**, then **Fast · Actions**, where everyone acts and marks **Done**. Leftover movement is not used in the actions half; the module does not lock tokens. "Previous phase" goes back half a phase. The setting applies to new combats.
- The **+** on an event phase (Lair Actions, by default after Slow) adds an event marker to it: a combatant with no actor that never rolls. The combat stops at that phase until the GM marks the marker done; a combat without a marker skips the phase. Markers move only between event phases, and only markers go there.
- Identical creatures are grouped inside their phase; the double-check button on the group marks all of them done at once.
- Automatic advance waits while the GM has a dialog open (rolls, activity use, reactions) and can be turned off.

### Settings

Module settings → **SC - Venaerys's Initiative** → **Configure**. The window has a tab rail and a footer with **Reset tab**, **Close** and **Save**; a dot marks every tab with unsaved changes.

- **World** (GM): phases in new combats, automatic advance, the phase suggested by an enemy's sheet, the roll against the DC (the system's initiative roll or a formula such as `1d20 + @abilities.dex.mod`; an empty formula uses the system's default, shown in the field), what a critical or a fumble does (automatic, or one degree as in Pathfinder 2e), where the DC comes from (typed, or a base plus the highest CR among the enemies of the Enemies phase; a fractional CR counts 0), default DC and base, and showing the DC to players.
- **Appearance** (GM): the theme of the module's screens and phase sections, one of the sixteen Shattered Codex themes (dark, light and stone; Verdant by default), with a sample of the phased tracker and a preview on your screen before you save. The combatant rows keep Foundry's own look.
- **Phases** (GM): the phase order of new combats. Drag phases (or use the arrows) anywhere around Fast, Enemies and Slow, whose order is fixed. Add, rename, recolor or delete extra phases; **Add event phase** creates one that only event markers act in. Worlds that saved their phase order before Lair Actions existed can add it this way. Each phase can have **actions when it starts**: a message, a sound, a hook, a chat message, a macro, a roll table, and, with those modules active, an SC Jump Scare, an SC Puzzle or an SC Resources change. Macros only run if a GM wrote them, and actions that show or play something are not run for players who cannot see the phase. Combats in progress keep their own copy.
- **This client**: showing the combat tracker when a phased combat starts, and being asked to roll initiative.
- **Help** (GM): how turn events, moving combatants, pending combatants and other modules behave with phases.

### Keybindings

Under **Configure Controls**, with no key assigned by default: **Mark my combatants done** (for the GM, the combatants no player owns), **Advance phase** and **Previous phase** (GM), and **Show the combat tracker**. Outside a running phased combat the first three do nothing and leave the key to other bindings.

### For macros and other modules

Two hooks are called on every client after the combat updates:

- `sc-venaerys-initiative.phaseChange(combat, {round, phaseId, previous: {round, phaseId}, reason})` when the combat enters another phase or round. `reason` is `advance`, `round`, `start`, `back` or `anchor` when the module moved the combat, `null` otherwise.
- `sc-venaerys-initiative.combatantDone(combatant, {done, round, phaseId})` when a combatant is marked done or unmarked.

On a player's client, a phase in which that player sees no one is reported as `null`, and hidden combatants are never reported.

## Systems

The core works with any system that uses Foundry's initiative order: the roll against the DC is the system's own initiative roll, or the GM's formula. Each supported system brings its own defaults:

- **D&D 5e** (5.x on v13, 6.x on v14): enemies show their initiative score, which also keeps identical creatures grouped; the CR of NPCs can set the DC; a natural 20 or 1 is read from the kept d20. Default formula `1d20 + @attributes.init.total`.
- **Pathfinder 2e**: the system's initiative roll (the statistic chosen on the sheet), without the modifiers dialog when the GM rolls for players. A natural 20 or 1 moves the result one degree by default. Default formula `1d20 + @actor.initiative.mod`.
- **Call of Cthulhu 7e**: with the system's optional initiative rule (a DEX roll), the DC is the difficulty the Keeper asks for: 1 Regular, 2 Hard, 3 Extreme, shown by name. With the basic rule nothing is rolled and the GM is warned; use the optional rule or a formula (`@characteristics.dex.value - 1d100` against DC 0).
- **Daggerheart** (experimental): it has no initiative of its own, so the module rolls a reaction roll, `1d12 + 1d12 + @system.traits.agility.value`; matching dice are a critical. It never gives Hope or Fear. Its own tracker passes the spotlight and may move turns and rounds by itself.
- Any other system: its initiative formula; enemies show 0 as their initiative and the DC is typed.

Systems that replace the combat tracker's row template (for example pf2e) lose their own row extras while a combat runs in phases; with phases off their tracker is untouched.

A formula roll is the module's own: it reads the actor's data but not the sheet's situational bonuses (advantage, feats, bonus dice). Use the system's roll to keep them.

## Known limitations

- Only one combatant is "the current turn" for Foundry. When a phase starts, start-of-turn automation (recharges, ongoing damage, reactions) runs for every member; end-of-turn automation runs only for the member marked with the hourglass, at the end of the phase. The others resolve end-of-turn effects by hand when they mark Done.
- Combatants who haven't rolled sit at the end of Foundry's order and receive the system's turn events at each round change.
- midi-qol's "reroll initiative each round" and "record attacks of opportunity", and Combat Tracker Dock's "hide enemies until their first turn", conflict with phases; turn them off in phased combats. When a phased combat starts with any of them on, every GM gets a warning.
- The natural 20 or 1 reaches the combat right after the roll's total, so a combatant may show in one phase for an instant before moving to the right one.
- On Foundry v14, the movement history of every combatant is cleared at each turn start, which with phases means at the start of each phase.

The module needs no other module.
