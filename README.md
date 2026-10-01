# SC - Venaerys's Initiative

Phased initiative for Foundry VTT v13 and v14. Instead of one turn at a time, combat runs in **phases**:

- Characters roll their normal initiative against a **DC** set by the GM. Those who meet it act in **Fast**, the rest in **Slow**.
- Enemies don't roll: they act together in **Enemies**, between Fast and Slow.
- Everyone in a phase acts **at the same time**, each with a full normal turn. Each one marks **Done**; when everybody in the phase is done, the combat moves on to the next phase by itself.
- The GM adds extra phases (Epic Boss, Boss, Mini-Boss, or any other) and drags them before, between or after the players' phases. Who is the boss is decided per combat, from the phase window.

Foundry keeps seeing a normal combat: the turn order of the native tracker follows the phases, and with phases turned off a combat is exactly Foundry's.

## Using it

1. Create a combat as usual. New combats use phases by default (a world setting); before the combat starts, the GM can switch phases on or off in the phase window.
2. Players roll initiative from their sheet or the combat tracker. The phase window shows who is still waiting for a roll.
3. Set the DC in the phase window and start the combat. If someone has not rolled and starting now would skip the players' first phase, the GM is asked first.
4. Mark **Done** when your turn is over. A player's "End turn" in the tracker does the same; the GM's "Next turn" and "Previous turn" become "Next phase" and "Previous phase".

The phase window opens on every client when a phased combat starts (a per-user setting) and from the **Phases** button in the combat tracker.

### For the GM

- **Next phase** advances even if someone hasn't marked Done. **Complete phase** marks everyone in the current phase done and advances. **Previous phase** goes back and keeps the marks; automatic advance then waits for the next mark in that phase.
- The phase select on each combatant pins them to a phase for this combat only ("Automatic" goes back to the rules). Moves never take a turn away or give an extra one: someone who already acted moves next round.
- **Skip this round** on a combatant of a later phase (surprise, stunned) marks them done in advance.
- Automatic advance waits while the GM has a dialog open (rolls, activity use, reactions) and can be turned off.

### Settings

Module settings → **SC - Venaerys's Initiative** → **Configure**:

- **General**: phases in new combats, automatic advance, default DC, showing the DC to players, opening the window when combat starts.
- **Phases**: the phase order of new combats. Drag phases (or use the arrows) anywhere around Fast, Enemies and Slow, whose order is fixed. Add, rename, recolor or delete extra phases. Combats in progress keep their own copy.
- **Help**: how turn events, pending combatants and other modules behave with phases.

## Systems

The core works with any system that uses Foundry's initiative order; enemies then show 0 as their initiative. With **dnd5e** (5.x on v13, 6.x on v14), enemies show their initiative score, which also keeps identical creatures grouped.

Systems without an initiative order (for example Daggerheart) are not supported.

## Known limitations

- Only one combatant is "the current turn" for Foundry. When a phase starts, start-of-turn automation (recharges, ongoing damage, reactions) runs for every member; end-of-turn automation runs only for the highlighted member, at the end of the phase. The others resolve end-of-turn effects by hand when they mark Done.
- Combatants who haven't rolled sit at the end of Foundry's order and receive the system's turn events at each round change.
- midi-qol's "reroll initiative each round" and "record attacks of opportunity", and Combat Tracker Dock's "hide enemies until their first turn", conflict with phases; turn them off in phased combats.
- On Foundry v14, the movement history of every combatant is cleared at each turn start, which with phases means at the start of each phase.

The module needs no other module.
