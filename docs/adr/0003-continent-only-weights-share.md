# Continent only weights share; lists stay worldwide and neutral

The visitor's continent changes one thing: share, and through it the default frequency levels. Regionals on the chosen continent count 1.5x, others 1x, and Worldwide (the default) counts all equally; the factor is fixed. The consensus list and the recommended list are computed once for everyone with every Regional weighted equally. This replaces the earlier fixed 1.5x Europe weighting in both share and the model, which suited one Dutch player but not a public site; per-continent lists were rejected because they would need a model run per continent on too few Regionals.

## Consequences

- The data must carry per-Regional counts per deck so the browser can recompute share; a single precomputed share is no longer enough.
