-- Migration — flag accompagnement sur les recettes (#49, P11).
-- Date : 2026-06-10
--
-- Ajoute recette.accompagnement (NULL autorisé = non caractérisé). Le catalogue
-- global (user_id IS NULL) étant en lecture seule (RLS), on l'auto-tague ici par
-- heuristique de NOM d'ingrédient — MÊME règle que lib/accompagnement.ts
-- (priorité au féculent, sinon légume, sinon NULL) :
--   1) féculent si un ingrédient matche FECULENTS_RX ;
--   2) sinon légume si un ingrédient matche LEGUMES_RX.
--
-- Parité JS/SQL : les deux motifs ci-dessous sont la copie EXACTE des regex de
-- lib/accompagnement.ts. Deux différences de syntaxe seulement : `\b` (JS) →
-- `\y` (frontière de mot Postgres), et la désaccentuation est faite ici par
-- translate() (built-in, pas d'extension) au lieu de String.normalize(). Toute
-- évolution des motifs doit être répercutée des deux côtés (cf. piège CLAUDE.md).
--
-- Imparfait et « à compléter » (faute de catégorie « féculents », et parce que
-- `legumes-fruits` mêle légumes / aromates / fruits) — mais bon défaut. Les
-- UPDATE sont scopés à user_id IS NULL (catalogue global) : ils ne touchent pas
-- les recettes perso (gérées par le formulaire) et couvrent le rejeu sur base
-- neuve (ils s'exécutent après le seed du catalogue).

alter table recette
  add column accompagnement text
  check (accompagnement is null or accompagnement in ('feculents', 'legumes'));

-- 1) Féculent prioritaire.
update recette r
set accompagnement = 'feculents'
where r.user_id is null
  and exists (
    select 1
    from recette_ingredient ri
    join ingredient i on i.id = ri.ingredient_id
    where ri.recette_id = r.id
      and translate(lower(i.nom), 'àâäéèêëïîôöùûüç', 'aaaeeeeiioouuuc') ~
        'p[âa]?tes|spaghettis?|tagliatelles?|pennes?|macaronis?|coquillettes?|lasagnes?|nouilles?|raviolis?|gnocchis?|ravioles?|fusillis?|farfalles?|linguines?|tortellinis?|vermicelles?|\yriz\y|risotto|quinoa|semoule|couscous|boulg(?:h)?our|ebly|polenta|millet|sarrasin|epeautre|lentilles?|pois chiches?|haricots? (?:blanc|rouge|noir)s?|flageolets?|pommes? de terre|patates?|frites?|crozets?|puree'
  );

-- 2) Légume si pas déjà tagué féculent.
update recette r
set accompagnement = 'legumes'
where r.user_id is null
  and r.accompagnement is null
  and exists (
    select 1
    from recette_ingredient ri
    join ingredient i on i.id = ri.ingredient_id
    where ri.recette_id = r.id
      and translate(lower(i.nom), 'àâäéèêëïîôöùûüç', 'aaaeeeeiioouuuc') ~
        'haricots? verts?|petits? pois|brocolis?|choux?-?fleurs?|choux?|carottes?|courgettes?|epinards?|ratatouille|poireaux?|legumes? verts?|betteraves?|butternut|potirons?|courges?|aubergines?|poivrons?|fenouil|navets?|panais|salsifis|endives?|blettes?|asperges?|champignons?|tomates?|concombres?|salades?|laitue|roquette|mache|cresson|artichauts?|celeri|edamame|poelee|piperade'
  );
