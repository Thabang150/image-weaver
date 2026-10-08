<!-- LOVABLE:BEGIN -->
> [!IMPORTANT]
> This project is connected to [Lovable](https://lovable.dev). Avoid rewriting
> published git history — force pushing, or rebasing/amending/squashing commits
> that are already pushed — as it rewrites history on Lovable's side and the
> user will likely lose their project history.
>
> Commits you push to the connected branch sync back to Lovable and show up in
> the editor, so keep the branch in a working state.
<!-- LOVABLE:END -->

- Keep the existing TanStack Start framework; the requested hosting target does not imply replacing the project runtime.
- Render brand and photographic assets with standard img tags and static /images paths, so images have no runtime JSON dependency and can be carried to other hosts with the public folder.
- Keep exactly two content routes, / and /preview; preview navigation scrolls within its single website-foundation page to preserve the requested two-route scope.
- Compute launch remaining time from an explicit UTC-offset timestamp in a pure shared utility; hydrate the clock in the browser to avoid server/client countdown mismatches.
