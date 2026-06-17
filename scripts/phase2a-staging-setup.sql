-- Phase 2A staging setup. Paste into the STAGING Supabase SQL editor
-- AFTER applying migrations 001–021 + 023. Creates 3 pilot brands +
-- brand_colors and inserts + activates their brand_patterns. Re-runnable.

-- 1. Brands (fresh staging has none — incl. Basecamp, HIGH-1).
INSERT INTO public.brands (user_id,name,website,industry,status,brand_colors)
SELECT 'staging-test','Basecamp','https://basecamp.com','Project management','ready',
 '{"primary":"#1b3a2b","secondary":"#f0c419","accent":"#2e7d32","neutral":"#0f172a"}'::jsonb
WHERE NOT EXISTS (SELECT 1 FROM public.brands WHERE name='Basecamp');
INSERT INTO public.brands (user_id,name,website,industry,status,brand_colors)
SELECT 'staging-test','Stripe-like (test)','https://stripe.com','Payments infrastructure','ready',
 '{"primary":"#0a2540","secondary":"#635bff","accent":"#00d4ff","neutral":"#0a0f1f"}'::jsonb
WHERE NOT EXISTS (SELECT 1 FROM public.brands WHERE name='Stripe-like (test)');
INSERT INTO public.brands (user_id,name,website,industry,status,brand_colors)
SELECT 'staging-test','HubSpot-like (test)','https://hubspot.com','Marketing software','ready',
 '{"primary":"#ff7a59","secondary":"#33475b","accent":"#ff5c35","neutral":"#1b2733"}'::jsonb
WHERE NOT EXISTS (SELECT 1 FROM public.brands WHERE name='HubSpot-like (test)');

-- ensure brand_colors set even if a brand pre-existed
UPDATE public.brands SET brand_colors='{"primary":"#1b3a2b","secondary":"#f0c419","accent":"#2e7d32","neutral":"#0f172a"}'::jsonb WHERE name='Basecamp';
UPDATE public.brands SET brand_colors='{"primary":"#0a2540","secondary":"#635bff","accent":"#00d4ff","neutral":"#0a0f1f"}'::jsonb WHERE name='Stripe-like (test)';
UPDATE public.brands SET brand_colors='{"primary":"#ff7a59","secondary":"#33475b","accent":"#ff5c35","neutral":"#1b2733"}'::jsonb WHERE name='HubSpot-like (test)';

-- 2. Active patterns (pattern jsonb has NO palette — palette is brand_colors above).
INSERT INTO public.brand_patterns (brand_id,version,pattern,is_active,source)
SELECT id,1,'{"color_dna":{"recomb":[[0.85,0.08,0.02],[0.06,0.95,0.04],[0.02,0.10,0.80]],"modulate":{"saturation":0.95,"hue":0,"brightness":1.0},"scrim_strength":0.5},"composition_dna":{"template":"center_convergence","focal":"center","negative_space":0.55},"motif_dna":{"family":"interlocking_hub","placement":"center_bleed","opacity":0.18,"scale":0.72,"blend":"screen"},"typography_dna":{"headline":{"font_id":"inter_display","weight":800,"case":"sentence","tracking":0},"cta":{"weight":700,"case":"sentence"}},"energy_dna":{"level":0.32},"spacing_dna":{"margin_ratio":0.065,"gap_ratio":0.32},"framing_dna":{"mode":"full_bleed","border":null,"corner_radius":0},"do_not_use":{"colors":["#7c3aed"],"placements":["dutch"],"max_motif_opacity":0.2,"border":false}}'::jsonb,true,'manual'
FROM public.brands WHERE name='Basecamp'
ON CONFLICT (brand_id,version) DO UPDATE SET pattern=EXCLUDED.pattern,is_active=true,updated_at=now();

INSERT INTO public.brand_patterns (brand_id,version,pattern,is_active,source)
SELECT id,1,'{"color_dna":{"recomb":[[0.82,0.04,0.16],[0.04,0.84,0.16],[0.10,0.06,1.05]],"modulate":{"saturation":1.12,"hue":0,"brightness":1.02},"scrim_strength":0.42},"composition_dna":{"template":"diagonal_precision","focal":"left","negative_space":0.3},"motif_dna":{"family":"diagonal_bars","placement":"edge","opacity":0.18,"scale":0.9,"blend":"overlay"},"typography_dna":{"headline":{"font_id":"inter_display","weight":700,"case":"sentence","tracking":-1},"cta":{"weight":700,"case":"upper"}},"energy_dna":{"level":0.58},"spacing_dna":{"margin_ratio":0.05,"gap_ratio":0.24},"framing_dna":{"mode":"full_bleed","border":null,"corner_radius":0},"do_not_use":{"colors":["#7c3aed"],"placements":[],"max_motif_opacity":0.2,"border":false}}'::jsonb,true,'manual'
FROM public.brands WHERE name='Stripe-like (test)'
ON CONFLICT (brand_id,version) DO UPDATE SET pattern=EXCLUDED.pattern,is_active=true,updated_at=now();

INSERT INTO public.brand_patterns (brand_id,version,pattern,is_active,source)
SELECT id,1,'{"color_dna":{"recomb":[[1.05,0.06,0.0],[0.10,0.82,0.02],[0.04,0.04,0.78]],"modulate":{"saturation":1.08,"hue":0,"brightness":1.02},"scrim_strength":0.46},"composition_dna":{"template":"orbital_growth","focal":"right","negative_space":0.4},"motif_dna":{"family":"orbital_dots","placement":"corner","opacity":0.18,"scale":0.85,"blend":"screen"},"typography_dna":{"headline":{"font_id":"inter_display","weight":700,"case":"sentence","tracking":0},"cta":{"weight":700,"case":"sentence"}},"energy_dna":{"level":0.5},"spacing_dna":{"margin_ratio":0.06,"gap_ratio":0.28},"framing_dna":{"mode":"full_bleed","border":null,"corner_radius":0},"do_not_use":{"colors":["#7c3aed"],"placements":["dutch"],"max_motif_opacity":0.2,"border":false}}'::jsonb,true,'manual'
FROM public.brands WHERE name='HubSpot-like (test)'
ON CONFLICT (brand_id,version) DO UPDATE SET pattern=EXCLUDED.pattern,is_active=true,updated_at=now();

-- 3. Verify (gates before running the harness)
SELECT count(*) AS active_patterns FROM brand_patterns WHERE is_active=true;        -- expect 3
SELECT name, brand_colors ? 'primary' AS p, brand_colors ? 'secondary' AS s, brand_colors ? 'accent' AS a
 FROM brands WHERE name IN ('Basecamp','Stripe-like (test)','HubSpot-like (test)'); -- 3 rows, p/s/a true
