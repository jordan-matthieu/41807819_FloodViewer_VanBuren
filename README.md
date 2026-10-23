# Van Buren Bay — November 2020 flood viewer

This independently deployable package contains only this site's display assets and metadata. It does not depend on or update the existing Sunset/Hanford Bay viewer or its GitHub Pages repository. All runtime links are relative, and all required viewer code is local.

The initial map is 2,550 × 2,260 m in EPSG:32617, with the reference styling, local basemaps, five-minute timeline, raw/refined comparison, shared colour/opacity selection, estimated disconnected-water state and optional current building contacts. Confidence metrics are included only where the corresponding source data exists. Print the selected map using the viewer's print controls.

## Validation status

Assembly alone does not certify the new source domain. `deployment_manifest.json` remains `readyForDeployment: false` until independent per-site numerical, spatial and browser checks pass. The workflow enforces that flag. No production validation is copied as proof for this site.

```powershell
python -B tools/validate_site.py --repo .
python -m http.server 8000 --directory site
```

Open `http://localhost:8000/` for local review. The site needs no Python service once hosted.

## Publish after approval

Use this folder's contents as a separate repository root. After explicit publication approval, push to that repository's `main` branch and choose **Settings → Pages → Build and deployment → Source → GitHub Actions**. The included workflow checks this package and uploads only `site/`.

Workflow dependencies audited on 22 October 2026: `actions/checkout@v6`, `actions/configure-pages@v6`, `actions/upload-pages-artifact@v5` and `actions/deploy-pages@v5`. These use Node 24-compatible first-party actions on the GitHub-hosted Ubuntu runner. The upload action's own metadata pins its underlying Node 24 artifact uploader. See GitHub's [Node runtime update](https://github.blog/changelog/2026-09-23-node-20-is-no-longer-available-in-github-actions/).

Official setup: https://docs.github.com/en/pages/getting-started-with-github-pages/configuring-a-publishing-source-for-your-github-pages-site

All source DFSU/DEM data, processing caches and the existing production deployment remain outside this package. Source descriptions are in `site/site_config.json` and `site/sources/`. Place and street labels are suppressed; building outlines are contextual and do not establish flood damage.

## Repository contents and project URL

Use the complete contents of this folder as one independent repository root, including `.github/`, `.gitignore`, `.gitattributes`, `deployment_manifest.json`, `tools/` and `site/.nojekyll`. Do not copy the surrounding project or staging directories. The workflow validates the package and publishes only `site/`, including its hidden static files.

The repository name is flexible because all runtime assets and navigation use relative URLs. For example, after publication approval, repository `lake-erie-van-buren-bay` would serve `site/index.html` at `https://OWNER.github.io/lake-erie-van-buren-bay/` (or `https://OWNER.github.io/lake-erie-van-buren-bay/index.html`). Do not add `/site/` to the published URL. No code changes or backend are required for the repository prefix.

The package includes all 193 display timesteps, local terrain/aerial maps, building stencils, logo, scripts, styling, confidence layers and source credits. It excludes numerical DFSU/MIKE setup/mesh files, source DEM rasters, NumPy caches, processing logs and intermediate reconstruction products. Full offline PNG review sets and poster exports remain outside the website package; the viewer retains its selected-map print controls.

Run `python -B tools/validate_site.py --repo . --require-ready` from this folder before publication. This also rejects numerical/intermediate files, verifies manifest file/frame counts and checks actual published file sizes. It accepts normal Git line-ending conversion between Windows and Linux. Use ordinary Git files; no Git LFS pointers or package installation are needed. The ZIP supplied with the handoff contains this repository root directly. No repository creation, commit, push or publication has been performed as part of preparation.
