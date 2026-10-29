# Changelog

The release workflow uses the section named after the version being released
as the release description, so every version needs one. `npm version <x.y.z>`
renames the `Unreleased` heading below to that version.

## 0.1.0

- First release. A picker with every emoji in sections, search by name, keyword, shortcode or the emoji itself, frequently used emojis, skin tone, and insertion at all cursors in one undo step.
- `:shortcode` suggestions while typing, kept out of code, math, links and other places where a colon is not an emoji, and conversion of a complete `:tada:`.
- Emojis the device cannot draw are hidden, checked per device.
