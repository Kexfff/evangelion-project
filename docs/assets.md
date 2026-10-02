# Assets and attribution

[← Documentation](README.md) · [Project home](../README.md)

## Default avatar

The bundled model is [`AvatarSample_B.vrm`](../AvatarSample_B.vrm), a VRM 0.x model supplied for this project. Its embedded title is **AvatarSample_B** and its author is **VRoid**. The original binary is used without modification.

The app keeps the stable `builtin:eva` asset identifier for compatibility. New character defaults and existing characters that use the built-in avatar now resolve to this model, in development, browser preview, and packaged Electron builds. The character's name/personality remain unchanged. No settings or memories need to be migrated.

Imported `custom:` avatars are not replaced. To use the default for such a character, open **Character cards → Use bundled avatar**, then **Save changes**. Existing lighting, camera, and animation preferences are preserved; adjust them in Avatar studio if you prefer different framing for the new model.

## Embedded metadata

These are the fields recorded in the supplied file, not a newly assigned license:

| Field                     | Embedded value   |
| ------------------------- | ---------------- |
| Title                     | `AvatarSample_B` |
| Author                    | `VRoid`          |
| Allowed users             | `Everyone`       |
| Commercial usage          | `Allow`          |
| Violent usage             | `Allow`          |
| Sexual usage              | `Allow`          |
| License name              | `Other`          |
| Additional license URL    | Empty            |
| Additional permission URL | Empty            |

The file does not identify a specific open-source license or include a license URL. The original source/license text has not been supplied in this repository; add it here when available. This project does not relabel the asset as MIT, CC0, or another assumed license.

## Animations

The nine supplied VRMA files in [`animations/`](../animations/) are retained unchanged. The renderer retargets them to the model's humanoid skeleton and supports both VRM 0.x and VRM 1.x. Animation ownership and redistribution terms remain separate from the application and the avatar; no new animation license is assigned here.
