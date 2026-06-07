-- Migration — recettes globales (catalogue partagé) — #2 PR1
-- Générée par scripts/generer-seed-recettes.mjs depuis data/recettes.json.
-- 1) RLS : les recettes globales (user_id IS NULL) sont visibles de tous,
--    en lecture seule (insert/update/delete restent « propriétaire »).
-- 2) Seed idempotent des 74 recettes de base en globales.

-- ------------------------------------------------------------
-- 1. RLS : lecture globale OU propriétaire
-- ------------------------------------------------------------
drop policy if exists "recette: lecture propriétaire" on recette;
drop policy if exists "recette: lecture globale ou propriétaire" on recette;
create policy "recette: lecture globale ou propriétaire"
  on recette for select
  using (user_id is null or auth.uid() = user_id);

drop policy if exists "recette_ingredient: lecture propriétaire" on recette_ingredient;
drop policy if exists "recette_ingredient: lecture globale ou propriétaire" on recette_ingredient;
create policy "recette_ingredient: lecture globale ou propriétaire"
  on recette_ingredient for select
  using (
    exists (
      select 1 from recette
      where recette.id = recette_ingredient.recette_id
      and (recette.user_id is null or recette.user_id = auth.uid())
    )
  );

-- ------------------------------------------------------------
-- 2. Seed idempotent des recettes globales
-- ------------------------------------------------------------
do $$
declare
  rid uuid;
begin
  -- Garde-fou : ne rien faire si le catalogue global existe déjà.
  if exists (select 1 from recette where user_id is null) then
    return;
  end if;

  -- Ingrédients distincts du catalogue.
  insert into ingredient (nom, categorie, fond_de_placard) values
    ('blanc de poulet', 'viandes-poissons', false),
    ('poêlée surgelée', 'surgeles', false),
    ('riz basmati', 'epicerie', true),
    ('pulpe de tomates', 'epicerie', false),
    ('oignon', 'legumes-fruits', true),
    ('ail', 'legumes-fruits', true),
    ('huile d''olive', 'epicerie', true),
    ('petits pois', 'surgeles', false),
    ('haricots verts', 'surgeles', false),
    ('beurre', 'produits-frais', true),
    ('persil', 'epicerie', true),
    ('chou-fleur', 'legumes-fruits', false),
    ('sauce curry', 'produits-frais', false),
    ('brocolis', 'legumes-fruits', false),
    ('estragon', 'epicerie', true),
    ('crème fraîche', 'produits-frais', false),
    ('échalote', 'legumes-fruits', false),
    ('jus de citron', 'epicerie', true),
    ('mozzarella', 'produits-frais', false),
    ('pesto', 'produits-frais', false),
    ('poireaux', 'legumes-fruits', false),
    ('sel', 'epicerie', true),
    ('poivre', 'epicerie', true),
    ('moutarde', 'epicerie', true),
    ('cuisses de poulet', 'viandes-poissons', false),
    ('poivron rouge', 'legumes-fruits', false),
    ('poivron vert', 'legumes-fruits', false),
    ('tomates', 'legumes-fruits', false),
    ('paprika', 'epicerie', true),
    ('bouquet garnis', 'epicerie', true),
    ('filet mignon de porc', 'viandes-poissons', false),
    ('emmental', 'produits-frais', true),
    ('pâte feuilletée', 'produits-frais', false),
    ('jambon', 'viandes-poissons', false),
    ('magret de canard', 'viandes-poissons', false),
    ('pommes de terre sarladaises', 'surgeles', false),
    ('saucisses de toulouse', 'viandes-poissons', false),
    ('gingembre', 'epicerie', true),
    ('huile', 'epicerie', true),
    ('viande hachée', 'viandes-poissons', false),
    ('haricots rouges', 'epicerie', false),
    ('blanquette de veau', 'viandes-poissons', false),
    ('carottes', 'legumes-fruits', false),
    ('champignons de Paris', 'legumes-fruits', false),
    ('œufs', 'produits-frais', false),
    ('kubor', 'epicerie', true),
    ('jus de citron', 'legumes-fruits', true),
    ('farine', 'epicerie', true),
    ('sauté de veau', 'viandes-poissons', false),
    ('chorizo', 'viandes-poissons', false),
    ('olives vertes', 'legumes-fruits', false),
    ('steaks hachés', 'surgeles', false),
    ('côtes de porc', 'viandes-poissons', false),
    ('poêlée legumes verts', 'surgeles', false),
    ('rôti de porc (tranches)', 'viandes-poissons', false),
    ('betteraves', 'legumes-fruits', false),
    ('lentilles vertes', 'epicerie', false),
    ('cuisses de canard confites', 'viandes-poissons', false),
    ('pommes de terre', 'legumes-fruits', false),
    ('lait', 'produits-frais', true),
    ('gigot d''agneau', 'viandes-poissons', false),
    ('pommes de terre grenailles', 'surgeles', false),
    ('romarin', 'epicerie', true),
    ('thym', 'epicerie', true),
    ('bœuf à braiser', 'viandes-poissons', false),
    ('navets', 'legumes-fruits', false),
    (' gros sel', 'epicerie', true),
    ('osso bucco de veau', 'viandes-poissons', false),
    ('pâtes', 'epicerie', false),
    ('tomates pelées', 'epicerie', false),
    ('vin blanc', 'epicerie', false),
    ('bouillon de veau', 'epicerie', false),
    ('citron', 'legumes-fruits', false),
    ('escalopes de dinde', 'viandes-poissons', false),
    ('ratatouille boite', 'epicerie', false),
    ('filets de poisson blanc', 'viandes-poissons', false),
    ('riz', 'epicerie', true),
    ('poivron jaune', 'legumes-fruits', false),
    ('herbes de Provence', 'epicerie', true),
    ('poêlée méditerranée', 'surgeles', false),
    ('tomates cerises', 'legumes-fruits', false),
    ('champignons', 'legumes-fruits', false),
    ('tagliatelles', 'epicerie', false),
    ('pavés de saumon', 'viandes-poissons', false),
    ('fusilli', 'epicerie', false),
    ('curry en poudre', 'epicerie', true),
    ('cordons bleus', 'epicerie', false),
    ('lentilles (boite)', 'epicerie', false),
    ('beignets de poulet', 'epicerie', false),
    ('penne', 'epicerie', false),
    ('boulettes de boeuf', 'surgeles', false),
    ('sauce provençale', 'epicerie', false),
    ('lardons', 'viandes-poissons', false),
    ('parmesan', 'produits-frais', false),
    ('navets boule d''or', 'legumes-fruits', false),
    ('lasagne', 'epicerie', false),
    ('épinards', 'surgeles', false),
    ('buche de chèvre', 'produits-frais', false),
    ('muscade', 'epicerie', true),
    ('feuilles de lasagne', 'epicerie', false),
    ('butternut', 'legumes-fruits', false),
    ('reblochon', 'produits-frais', false),
    ('ravioles', 'produits-frais', false),
    ('crème fraîche semi-épaisse', 'produits-frais', false),
    ('comté', 'produits-frais', false),
    ('crozets', 'epicerie', false),
    ('fromage à raclette', 'produits-frais', false),
    ('dés de jambon', 'viandes-poissons', false),
    ('pâte feuilletée', 'boulangerie', false),
    ('jambon cru (tranches)', 'viandes-poissons', false),
    ('thon en boite', 'epicerie', false),
    ('wraps', 'boulangerie', false),
    ('jambon blanc (tranche)', 'viandes-poissons', false),
    ('tartare', 'produits-frais', false),
    ('bun''s ketchup', 'boulangerie', false),
    ('frites', 'surgeles', false),
    ('pain burger', 'boulangerie', false),
    ('ketchup', 'epicerie', false),
    ('mayonnaise', 'epicerie', true),
    ('croustibat', 'surgeles', false),
    ('croissants', 'boulangerie', false),
    ('feta', 'produits-frais', false),
    ('levure chimique', 'epicerie', true),
    ('lentilles corail', 'epicerie', false),
    ('lait de coco', 'epicerie', false),
    ('coriandre', 'epicerie', true),
    ('curcuma', 'epicerie', true),
    ('cumin', 'epicerie', true),
    ('moutarde à l''ancienne', 'epicerie', true),
    ('taboulé', 'epicerie', false),
    ('concombre', 'legumes-fruits', false),
    ('paella surgelée', 'surgeles', false),
    ('patates douces', 'legumes-fruits', false),
    ('courgette', 'legumes-fruits', false),
    ('pate de curry', 'epicerie', false),
    ('pain tranché', 'boulangerie', false),
    ('émincé de poulet', 'viandes-poissons', false),
    ('laitue iceberg', 'legumes-fruits', false),
    ('parmesan (copeaux)', 'produits-frais', false),
    ('croûtons', 'boulangerie', false),
    ('maïs', 'epicerie', false),
    ('sauce césar', 'epicerie', false);

  -- Recettes globales + leurs liens ingrédients.
  insert into recette (nom, temps_preparation, user_id) values ('Poulet poêlée', 'rapide', null) returning id into rid;
  insert into recette_ingredient (recette_id, ingredient_id, quantite, unite)
    select rid, ing.id, v.quantite, v.unite from (values
    ('blanc de poulet', 'viandes-poissons', false, 2, 'piece'),
    ('poêlée surgelée', 'surgeles', false, 1, 'piece')
    ) as v(nom, categorie, fond, quantite, unite)
    join ingredient ing on ing.nom = v.nom and ing.categorie = v.categorie and ing.fond_de_placard = v.fond;
  insert into recette (nom, temps_preparation, user_id) values ('Poulet riz tomates', 'normal', null) returning id into rid;
  insert into recette_ingredient (recette_id, ingredient_id, quantite, unite)
    select rid, ing.id, v.quantite, v.unite from (values
    ('blanc de poulet', 'viandes-poissons', false, 2, 'piece'),
    ('riz basmati', 'epicerie', true, 150, 'g'),
    ('pulpe de tomates', 'epicerie', false, 1, 'piece'),
    ('oignon', 'legumes-fruits', true, 1, 'piece'),
    ('ail', 'legumes-fruits', true, 2, 'piece'),
    ('huile d''olive', 'epicerie', true, 1, 'cas')
    ) as v(nom, categorie, fond, quantite, unite)
    join ingredient ing on ing.nom = v.nom and ing.categorie = v.categorie and ing.fond_de_placard = v.fond;
  insert into recette (nom, temps_preparation, user_id) values ('Poulet petits pois', 'rapide', null) returning id into rid;
  insert into recette_ingredient (recette_id, ingredient_id, quantite, unite)
    select rid, ing.id, v.quantite, v.unite from (values
    ('blanc de poulet', 'viandes-poissons', false, 2, 'piece'),
    ('petits pois', 'surgeles', false, 400, 'g')
    ) as v(nom, categorie, fond, quantite, unite)
    join ingredient ing on ing.nom = v.nom and ing.categorie = v.categorie and ing.fond_de_placard = v.fond;
  insert into recette (nom, temps_preparation, user_id) values ('Poulet haricots verts', 'rapide', null) returning id into rid;
  insert into recette_ingredient (recette_id, ingredient_id, quantite, unite)
    select rid, ing.id, v.quantite, v.unite from (values
    ('blanc de poulet', 'viandes-poissons', false, 2, 'piece'),
    ('haricots verts', 'surgeles', false, 400, 'g'),
    ('beurre', 'produits-frais', true, 20, 'g'),
    ('ail', 'legumes-fruits', true, 2, 'piece'),
    ('huile d''olive', 'epicerie', true, 1, 'cas'),
    ('persil', 'epicerie', true, 1, 'cas')
    ) as v(nom, categorie, fond, quantite, unite)
    join ingredient ing on ing.nom = v.nom and ing.categorie = v.categorie and ing.fond_de_placard = v.fond;
  insert into recette (nom, temps_preparation, user_id) values ('Poulet choux-fleur', 'normal', null) returning id into rid;
  insert into recette_ingredient (recette_id, ingredient_id, quantite, unite)
    select rid, ing.id, v.quantite, v.unite from (values
    ('blanc de poulet', 'viandes-poissons', false, 2, 'piece'),
    ('chou-fleur', 'legumes-fruits', false, 1, 'piece')
    ) as v(nom, categorie, fond, quantite, unite)
    join ingredient ing on ing.nom = v.nom and ing.categorie = v.categorie and ing.fond_de_placard = v.fond;
  insert into recette (nom, temps_preparation, user_id) values ('Poulet curry', 'normal', null) returning id into rid;
  insert into recette_ingredient (recette_id, ingredient_id, quantite, unite)
    select rid, ing.id, v.quantite, v.unite from (values
    ('blanc de poulet', 'viandes-poissons', false, 2, 'piece'),
    ('oignon', 'legumes-fruits', true, 1, 'piece'),
    ('pulpe de tomates', 'epicerie', false, 1, 'piece'),
    ('sauce curry', 'produits-frais', false, 1, 'piece'),
    ('ail', 'legumes-fruits', true, 1, 'piece'),
    ('brocolis', 'legumes-fruits', false, 1, 'piece'),
    ('huile d''olive', 'epicerie', true, 1, 'cas')
    ) as v(nom, categorie, fond, quantite, unite)
    join ingredient ing on ing.nom = v.nom and ing.categorie = v.categorie and ing.fond_de_placard = v.fond;
  insert into recette (nom, temps_preparation, user_id) values ('Poulet estragon crème haricots verts', 'long', null) returning id into rid;
  insert into recette_ingredient (recette_id, ingredient_id, quantite, unite)
    select rid, ing.id, v.quantite, v.unite from (values
    ('blanc de poulet', 'viandes-poissons', false, 2, 'piece'),
    ('haricots verts', 'surgeles', false, 300, 'g'),
    ('estragon', 'epicerie', true, 1, 'cas'),
    ('crème fraîche', 'produits-frais', false, 20, 'cl'),
    ('échalote', 'legumes-fruits', false, 1, 'piece'),
    ('jus de citron', 'epicerie', true, 10, 'cas'),
    ('huile d''olive', 'epicerie', true, 1, 'cas')
    ) as v(nom, categorie, fond, quantite, unite)
    join ingredient ing on ing.nom = v.nom and ing.categorie = v.categorie and ing.fond_de_placard = v.fond;
  insert into recette (nom, temps_preparation, user_id) values ('Poulet mozza pesto', 'normal', null) returning id into rid;
  insert into recette_ingredient (recette_id, ingredient_id, quantite, unite)
    select rid, ing.id, v.quantite, v.unite from (values
    ('blanc de poulet', 'viandes-poissons', false, 2, 'piece'),
    ('mozzarella', 'produits-frais', false, 125, 'g'),
    ('pesto', 'produits-frais', false, 2, 'cas')
    ) as v(nom, categorie, fond, quantite, unite)
    join ingredient ing on ing.nom = v.nom and ing.categorie = v.categorie and ing.fond_de_placard = v.fond;
  insert into recette (nom, temps_preparation, user_id) values ('Poulet brocolis', 'normal', null) returning id into rid;
  insert into recette_ingredient (recette_id, ingredient_id, quantite, unite)
    select rid, ing.id, v.quantite, v.unite from (values
    ('blanc de poulet', 'viandes-poissons', false, 2, 'piece'),
    ('brocolis', 'legumes-fruits', false, 1, 'piece')
    ) as v(nom, categorie, fond, quantite, unite)
    join ingredient ing on ing.nom = v.nom and ing.categorie = v.categorie and ing.fond_de_placard = v.fond;
  insert into recette (nom, temps_preparation, user_id) values ('Poulet fondue de poireaux', 'long', null) returning id into rid;
  insert into recette_ingredient (recette_id, ingredient_id, quantite, unite)
    select rid, ing.id, v.quantite, v.unite from (values
    ('blanc de poulet', 'viandes-poissons', false, 2, 'piece'),
    ('poireaux', 'legumes-fruits', false, 4, 'piece'),
    ('crème fraîche', 'produits-frais', false, 20, 'cl'),
    ('beurre', 'produits-frais', true, 20, 'g'),
    ('sel', 'epicerie', true, 1, 'cac'),
    ('poivre', 'epicerie', true, 1, 'cac'),
    ('moutarde', 'epicerie', true, 3, 'cac')
    ) as v(nom, categorie, fond, quantite, unite)
    join ingredient ing on ing.nom = v.nom and ing.categorie = v.categorie and ing.fond_de_placard = v.fond;
  insert into recette (nom, temps_preparation, user_id) values ('Poulet basquaise', 'long', null) returning id into rid;
  insert into recette_ingredient (recette_id, ingredient_id, quantite, unite)
    select rid, ing.id, v.quantite, v.unite from (values
    ('cuisses de poulet', 'viandes-poissons', false, 600, 'g'),
    ('poivron rouge', 'legumes-fruits', false, 1, 'piece'),
    ('poivron vert', 'legumes-fruits', false, 1, 'piece'),
    ('tomates', 'legumes-fruits', false, 3, 'piece'),
    ('oignon', 'legumes-fruits', true, 1, 'piece'),
    ('ail', 'legumes-fruits', true, 3, 'piece'),
    ('huile d''olive', 'epicerie', true, 2, 'cas'),
    ('paprika', 'epicerie', true, 1, 'cac'),
    ('bouquet garnis', 'epicerie', true, 1, 'piece'),
    ('sel', 'epicerie', true, 1, 'cac'),
    ('poivre', 'epicerie', true, 1, 'cac'),
    ('riz basmati', 'epicerie', true, 130, 'g')
    ) as v(nom, categorie, fond, quantite, unite)
    join ingredient ing on ing.nom = v.nom and ing.categorie = v.categorie and ing.fond_de_placard = v.fond;
  insert into recette (nom, temps_preparation, user_id) values ('Filet mignon haricots verts', 'long', null) returning id into rid;
  insert into recette_ingredient (recette_id, ingredient_id, quantite, unite)
    select rid, ing.id, v.quantite, v.unite from (values
    ('filet mignon de porc', 'viandes-poissons', false, 400, 'g'),
    ('haricots verts', 'surgeles', false, 400, 'g'),
    ('oignon', 'legumes-fruits', true, 1, 'piece'),
    ('emmental', 'produits-frais', true, 50, 'g'),
    ('pâte feuilletée', 'produits-frais', false, 1, 'piece'),
    ('jambon', 'viandes-poissons', false, 2, 'piece')
    ) as v(nom, categorie, fond, quantite, unite)
    join ingredient ing on ing.nom = v.nom and ing.categorie = v.categorie and ing.fond_de_placard = v.fond;
  insert into recette (nom, temps_preparation, user_id) values ('Filet mignon poireaux moutarde', 'long', null) returning id into rid;
  insert into recette_ingredient (recette_id, ingredient_id, quantite, unite)
    select rid, ing.id, v.quantite, v.unite from (values
    ('filet mignon de porc', 'viandes-poissons', false, 400, 'g'),
    ('poireaux', 'legumes-fruits', false, 4, 'piece'),
    ('crème fraîche', 'produits-frais', false, 20, 'cl'),
    ('beurre', 'produits-frais', true, 20, 'g'),
    ('sel', 'epicerie', true, 1, 'cac'),
    ('poivre', 'epicerie', true, 1, 'cac'),
    ('moutarde', 'epicerie', true, 3, 'cac')
    ) as v(nom, categorie, fond, quantite, unite)
    join ingredient ing on ing.nom = v.nom and ing.categorie = v.categorie and ing.fond_de_placard = v.fond;
  insert into recette (nom, temps_preparation, user_id) values ('Magret de canard patates sarladaises', 'normal', null) returning id into rid;
  insert into recette_ingredient (recette_id, ingredient_id, quantite, unite)
    select rid, ing.id, v.quantite, v.unite from (values
    ('magret de canard', 'viandes-poissons', false, 2, 'piece'),
    ('pommes de terre sarladaises', 'surgeles', false, 600, 'g')
    ) as v(nom, categorie, fond, quantite, unite)
    join ingredient ing on ing.nom = v.nom and ing.categorie = v.categorie and ing.fond_de_placard = v.fond;
  insert into recette (nom, temps_preparation, user_id) values ('Rougail saucisses', 'normal', null) returning id into rid;
  insert into recette_ingredient (recette_id, ingredient_id, quantite, unite)
    select rid, ing.id, v.quantite, v.unite from (values
    ('saucisses de toulouse', 'viandes-poissons', false, 400, 'g'),
    ('pulpe de tomates', 'epicerie', false, 1, 'piece'),
    ('oignon', 'legumes-fruits', true, 1, 'piece'),
    ('gingembre', 'epicerie', true, 1, 'cac'),
    ('ail', 'legumes-fruits', true, 2, 'piece'),
    ('huile', 'epicerie', true, 1, 'cas'),
    ('riz basmati', 'epicerie', true, 130, 'g')
    ) as v(nom, categorie, fond, quantite, unite)
    join ingredient ing on ing.nom = v.nom and ing.categorie = v.categorie and ing.fond_de_placard = v.fond;
  insert into recette (nom, temps_preparation, user_id) values ('Chili con carne', 'normal', null) returning id into rid;
  insert into recette_ingredient (recette_id, ingredient_id, quantite, unite)
    select rid, ing.id, v.quantite, v.unite from (values
    ('viande hachée', 'viandes-poissons', false, 300, 'g'),
    ('haricots rouges', 'epicerie', false, 200, 'g'),
    ('pulpe de tomates', 'epicerie', false, 1, 'piece'),
    ('oignon', 'legumes-fruits', true, 1, 'piece'),
    ('poivron rouge', 'legumes-fruits', false, 1, 'piece'),
    ('ail', 'legumes-fruits', true, 2, 'piece'),
    ('paprika', 'epicerie', true, 1, 'cac'),
    ('huile d''olive', 'epicerie', true, 1, 'cas'),
    ('sel', 'epicerie', true, 1, 'cac'),
    ('poivre', 'epicerie', true, 1, 'cac'),
    ('riz basmati', 'epicerie', true, 130, 'g')
    ) as v(nom, categorie, fond, quantite, unite)
    join ingredient ing on ing.nom = v.nom and ing.categorie = v.categorie and ing.fond_de_placard = v.fond;
  insert into recette (nom, temps_preparation, user_id) values ('Blanquette de veau', 'long', null) returning id into rid;
  insert into recette_ingredient (recette_id, ingredient_id, quantite, unite)
    select rid, ing.id, v.quantite, v.unite from (values
    ('blanquette de veau', 'viandes-poissons', false, 400, 'g'),
    ('carottes', 'legumes-fruits', false, 1, 'piece'),
    ('oignon', 'legumes-fruits', true, 1, 'piece'),
    ('champignons de Paris', 'legumes-fruits', false, 1, 'piece'),
    ('crème fraîche', 'produits-frais', false, 20, 'cl'),
    ('œufs', 'produits-frais', false, 1, 'piece'),
    ('kubor', 'epicerie', true, 1, 'piece'),
    ('jus de citron', 'legumes-fruits', true, 1, 'cas'),
    ('farine', 'epicerie', true, 2, 'cas'),
    ('bouquet garnis', 'epicerie', true, 1, 'piece'),
    ('riz basmati', 'epicerie', true, 130, 'g')
    ) as v(nom, categorie, fond, quantite, unite)
    join ingredient ing on ing.nom = v.nom and ing.categorie = v.categorie and ing.fond_de_placard = v.fond;
  insert into recette (nom, temps_preparation, user_id) values ('Sauté de veau', 'long', null) returning id into rid;
  insert into recette_ingredient (recette_id, ingredient_id, quantite, unite)
    select rid, ing.id, v.quantite, v.unite from (values
    ('sauté de veau', 'viandes-poissons', false, 400, 'g'),
    ('pulpe de tomates', 'epicerie', false, 1, 'piece'),
    ('oignon', 'legumes-fruits', true, 1, 'piece'),
    ('chorizo', 'viandes-poissons', false, 0.5, 'piece'),
    ('olives vertes', 'legumes-fruits', false, 0.5, 'piece'),
    ('ail', 'legumes-fruits', true, 1, 'piece'),
    ('huile d''olive', 'epicerie', true, 1, 'cas'),
    ('bouquet garnis', 'epicerie', true, 1, 'piece')
    ) as v(nom, categorie, fond, quantite, unite)
    join ingredient ing on ing.nom = v.nom and ing.categorie = v.categorie and ing.fond_de_placard = v.fond;
  insert into recette (nom, temps_preparation, user_id) values ('Steaks haricots verts', 'rapide', null) returning id into rid;
  insert into recette_ingredient (recette_id, ingredient_id, quantite, unite)
    select rid, ing.id, v.quantite, v.unite from (values
    ('steaks hachés', 'surgeles', false, 2, 'piece'),
    ('haricots verts', 'surgeles', false, 400, 'g')
    ) as v(nom, categorie, fond, quantite, unite)
    join ingredient ing on ing.nom = v.nom and ing.categorie = v.categorie and ing.fond_de_placard = v.fond;
  insert into recette (nom, temps_preparation, user_id) values ('Côtes de porc légumes verts', 'rapide', null) returning id into rid;
  insert into recette_ingredient (recette_id, ingredient_id, quantite, unite)
    select rid, ing.id, v.quantite, v.unite from (values
    ('côtes de porc', 'viandes-poissons', false, 2, 'piece'),
    ('poêlée legumes verts', 'surgeles', false, 400, 'g')
    ) as v(nom, categorie, fond, quantite, unite)
    join ingredient ing on ing.nom = v.nom and ing.categorie = v.categorie and ing.fond_de_placard = v.fond;
  insert into recette (nom, temps_preparation, user_id) values ('Rôti de porc betteraves', 'rapide', null) returning id into rid;
  insert into recette_ingredient (recette_id, ingredient_id, quantite, unite)
    select rid, ing.id, v.quantite, v.unite from (values
    ('rôti de porc (tranches)', 'viandes-poissons', false, 2, 'piece'),
    ('betteraves', 'legumes-fruits', false, 5, 'piece')
    ) as v(nom, categorie, fond, quantite, unite)
    join ingredient ing on ing.nom = v.nom and ing.categorie = v.categorie and ing.fond_de_placard = v.fond;
  insert into recette (nom, temps_preparation, user_id) values ('Saucisse lentilles', 'long', null) returning id into rid;
  insert into recette_ingredient (recette_id, ingredient_id, quantite, unite)
    select rid, ing.id, v.quantite, v.unite from (values
    ('saucisses de toulouse', 'viandes-poissons', false, 400, 'g'),
    ('lentilles vertes', 'epicerie', false, 150, 'g'),
    ('carottes', 'legumes-fruits', false, 0.5, 'piece'),
    ('oignon', 'legumes-fruits', true, 0.5, 'piece'),
    ('kubor', 'epicerie', true, 0.5, 'piece'),
    ('bouquet garnis', 'epicerie', true, 0.5, 'piece'),
    ('sel', 'epicerie', true, 1, 'cac'),
    ('poivre', 'epicerie', true, 1, 'cac')
    ) as v(nom, categorie, fond, quantite, unite)
    join ingredient ing on ing.nom = v.nom and ing.categorie = v.categorie and ing.fond_de_placard = v.fond;
  insert into recette (nom, temps_preparation, user_id) values ('Hachis parmentier canard', 'long', null) returning id into rid;
  insert into recette_ingredient (recette_id, ingredient_id, quantite, unite)
    select rid, ing.id, v.quantite, v.unite from (values
    ('cuisses de canard confites', 'viandes-poissons', false, 2, 'piece'),
    ('pommes de terre', 'legumes-fruits', false, 500, 'g'),
    ('oignon', 'legumes-fruits', true, 1, 'piece'),
    ('lait', 'produits-frais', true, 100, 'ml'),
    ('beurre', 'produits-frais', true, 30, 'g'),
    ('emmental', 'produits-frais', true, 50, 'g'),
    ('sel', 'epicerie', true, 1, 'cac'),
    ('poivre', 'epicerie', true, 1, 'cac')
    ) as v(nom, categorie, fond, quantite, unite)
    join ingredient ing on ing.nom = v.nom and ing.categorie = v.categorie and ing.fond_de_placard = v.fond;
  insert into recette (nom, temps_preparation, user_id) values ('Hachoux parmentier canard', 'long', null) returning id into rid;
  insert into recette_ingredient (recette_id, ingredient_id, quantite, unite)
    select rid, ing.id, v.quantite, v.unite from (values
    ('cuisses de canard confites', 'viandes-poissons', false, 2, 'piece'),
    ('pommes de terre', 'legumes-fruits', false, 200, 'g'),
    ('chou-fleur', 'legumes-fruits', false, 0.5, 'piece'),
    ('oignon', 'legumes-fruits', true, 1, 'piece'),
    ('lait', 'produits-frais', true, 100, 'ml'),
    ('beurre', 'produits-frais', true, 30, 'g'),
    ('emmental', 'produits-frais', true, 50, 'g'),
    ('sel', 'epicerie', true, 1, 'cac'),
    ('poivre', 'epicerie', true, 1, 'cac')
    ) as v(nom, categorie, fond, quantite, unite)
    join ingredient ing on ing.nom = v.nom and ing.categorie = v.categorie and ing.fond_de_placard = v.fond;
  insert into recette (nom, temps_preparation, user_id) values ('Gigot d''agneau pommes grenailles', 'long', null) returning id into rid;
  insert into recette_ingredient (recette_id, ingredient_id, quantite, unite)
    select rid, ing.id, v.quantite, v.unite from (values
    ('gigot d''agneau', 'viandes-poissons', false, 800, 'g'),
    ('pommes de terre grenailles', 'surgeles', false, 400, 'g'),
    ('romarin', 'epicerie', true, 1, 'cac'),
    ('ail', 'legumes-fruits', true, 4, 'piece'),
    ('huile d''olive', 'epicerie', true, 2, 'cas'),
    ('thym', 'epicerie', true, 1, 'cac'),
    ('sel', 'epicerie', true, 1, 'cac'),
    ('poivre', 'epicerie', true, 1, 'cac')
    ) as v(nom, categorie, fond, quantite, unite)
    join ingredient ing on ing.nom = v.nom and ing.categorie = v.categorie and ing.fond_de_placard = v.fond;
  insert into recette (nom, temps_preparation, user_id) values ('Pot au feu', 'long', null) returning id into rid;
  insert into recette_ingredient (recette_id, ingredient_id, quantite, unite)
    select rid, ing.id, v.quantite, v.unite from (values
    ('bœuf à braiser', 'viandes-poissons', false, 500, 'g'),
    ('carottes', 'legumes-fruits', false, 2, 'piece'),
    ('navets', 'legumes-fruits', false, 2, 'piece'),
    ('poireaux', 'legumes-fruits', false, 1, 'piece'),
    ('pommes de terre', 'legumes-fruits', false, 300, 'g'),
    ('oignon', 'legumes-fruits', true, 1, 'piece'),
    ('bouquet garnis', 'epicerie', true, 0.5, 'piece'),
    (' gros sel', 'epicerie', true, 1, 'cac')
    ) as v(nom, categorie, fond, quantite, unite)
    join ingredient ing on ing.nom = v.nom and ing.categorie = v.categorie and ing.fond_de_placard = v.fond;
  insert into recette (nom, temps_preparation, user_id) values ('Osso bucco pâtes', 'long', null) returning id into rid;
  insert into recette_ingredient (recette_id, ingredient_id, quantite, unite)
    select rid, ing.id, v.quantite, v.unite from (values
    ('osso bucco de veau', 'viandes-poissons', false, 2, 'piece'),
    ('pâtes', 'epicerie', false, 200, 'g'),
    ('tomates pelées', 'epicerie', false, 400, 'g'),
    ('oignon', 'legumes-fruits', true, 1, 'piece'),
    ('carottes', 'legumes-fruits', false, 1, 'piece'),
    ('vin blanc', 'epicerie', false, 10, 'cl'),
    ('bouillon de veau', 'epicerie', false, 200, 'ml'),
    ('citron', 'legumes-fruits', false, 1, 'piece'),
    ('ail', 'legumes-fruits', true, 2, 'piece'),
    ('farine', 'epicerie', true, 2, 'cas'),
    ('huile d''olive', 'epicerie', true, 1, 'cas'),
    ('bouquet garnis', 'epicerie', true, 1, 'piece'),
    ('sel', 'epicerie', true, 1, 'cac'),
    ('poivre', 'epicerie', true, 1, 'cac')
    ) as v(nom, categorie, fond, quantite, unite)
    join ingredient ing on ing.nom = v.nom and ing.categorie = v.categorie and ing.fond_de_placard = v.fond;
  insert into recette (nom, temps_preparation, user_id) values ('Confit de canard patates', 'normal', null) returning id into rid;
  insert into recette_ingredient (recette_id, ingredient_id, quantite, unite)
    select rid, ing.id, v.quantite, v.unite from (values
    ('cuisses de canard confites', 'viandes-poissons', false, 2, 'piece'),
    ('pommes de terre sarladaises', 'surgeles', false, 400, 'g')
    ) as v(nom, categorie, fond, quantite, unite)
    join ingredient ing on ing.nom = v.nom and ing.categorie = v.categorie and ing.fond_de_placard = v.fond;
  insert into recette (nom, temps_preparation, user_id) values ('Escalope dinde ratatouille', 'normal', null) returning id into rid;
  insert into recette_ingredient (recette_id, ingredient_id, quantite, unite)
    select rid, ing.id, v.quantite, v.unite from (values
    ('escalopes de dinde', 'viandes-poissons', false, 2, 'piece'),
    ('ratatouille boite', 'epicerie', false, 1, 'piece')
    ) as v(nom, categorie, fond, quantite, unite)
    join ingredient ing on ing.nom = v.nom and ing.categorie = v.categorie and ing.fond_de_placard = v.fond;
  insert into recette (nom, temps_preparation, user_id) values ('Poisson petits pois', 'rapide', null) returning id into rid;
  insert into recette_ingredient (recette_id, ingredient_id, quantite, unite)
    select rid, ing.id, v.quantite, v.unite from (values
    ('filets de poisson blanc', 'viandes-poissons', false, 300, 'g'),
    ('petits pois', 'surgeles', false, 400, 'g')
    ) as v(nom, categorie, fond, quantite, unite)
    join ingredient ing on ing.nom = v.nom and ing.categorie = v.categorie and ing.fond_de_placard = v.fond;
  insert into recette (nom, temps_preparation, user_id) values ('Poisson haricots verts', 'rapide', null) returning id into rid;
  insert into recette_ingredient (recette_id, ingredient_id, quantite, unite)
    select rid, ing.id, v.quantite, v.unite from (values
    ('filets de poisson blanc', 'viandes-poissons', false, 300, 'g'),
    ('haricots verts', 'surgeles', false, 400, 'g')
    ) as v(nom, categorie, fond, quantite, unite)
    join ingredient ing on ing.nom = v.nom and ing.categorie = v.categorie and ing.fond_de_placard = v.fond;
  insert into recette (nom, temps_preparation, user_id) values ('Poisson riz', 'normal', null) returning id into rid;
  insert into recette_ingredient (recette_id, ingredient_id, quantite, unite)
    select rid, ing.id, v.quantite, v.unite from (values
    ('filets de poisson blanc', 'viandes-poissons', false, 300, 'g'),
    ('riz', 'epicerie', true, 130, 'g')
    ) as v(nom, categorie, fond, quantite, unite)
    join ingredient ing on ing.nom = v.nom and ing.categorie = v.categorie and ing.fond_de_placard = v.fond;
  insert into recette (nom, temps_preparation, user_id) values ('Poisson piperade', 'long', null) returning id into rid;
  insert into recette_ingredient (recette_id, ingredient_id, quantite, unite)
    select rid, ing.id, v.quantite, v.unite from (values
    ('filets de poisson blanc', 'viandes-poissons', false, 300, 'g'),
    ('poivron rouge', 'legumes-fruits', false, 1, 'piece'),
    ('poivron vert', 'legumes-fruits', false, 1, 'piece'),
    ('poivron jaune', 'legumes-fruits', false, 1, 'piece'),
    ('oignon', 'legumes-fruits', true, 1, 'piece'),
    ('ail', 'legumes-fruits', true, 1, 'piece'),
    ('huile d''olive', 'epicerie', true, 1, 'cas'),
    ('paprika', 'epicerie', true, 1, 'cac'),
    ('herbes de Provence', 'epicerie', true, 1, 'cac'),
    ('sel', 'epicerie', true, 1, 'cac'),
    ('poivre', 'epicerie', true, 1, 'cac')
    ) as v(nom, categorie, fond, quantite, unite)
    join ingredient ing on ing.nom = v.nom and ing.categorie = v.categorie and ing.fond_de_placard = v.fond;
  insert into recette (nom, temps_preparation, user_id) values ('Poisson poêlée Méditerranée', 'rapide', null) returning id into rid;
  insert into recette_ingredient (recette_id, ingredient_id, quantite, unite)
    select rid, ing.id, v.quantite, v.unite from (values
    ('filets de poisson blanc', 'viandes-poissons', false, 300, 'g'),
    ('poêlée méditerranée', 'surgeles', false, 400, 'g')
    ) as v(nom, categorie, fond, quantite, unite)
    join ingredient ing on ing.nom = v.nom and ing.categorie = v.categorie and ing.fond_de_placard = v.fond;
  insert into recette (nom, temps_preparation, user_id) values ('Poisson papillote petits pois', 'normal', null) returning id into rid;
  insert into recette_ingredient (recette_id, ingredient_id, quantite, unite)
    select rid, ing.id, v.quantite, v.unite from (values
    ('filets de poisson blanc', 'viandes-poissons', false, 300, 'g'),
    ('petits pois', 'surgeles', false, 400, 'g'),
    ('échalote', 'legumes-fruits', false, 1, 'piece'),
    ('jus de citron', 'epicerie', true, 1, 'cas'),
    ('tomates cerises', 'legumes-fruits', false, 100, 'g'),
    ('estragon', 'epicerie', true, 1, 'cac'),
    ('sel', 'epicerie', true, 1, 'cac'),
    ('poivre', 'epicerie', true, 1, 'cac')
    ) as v(nom, categorie, fond, quantite, unite)
    join ingredient ing on ing.nom = v.nom and ing.categorie = v.categorie and ing.fond_de_placard = v.fond;
  insert into recette (nom, temps_preparation, user_id) values ('Blanquette de poisson', 'normal', null) returning id into rid;
  insert into recette_ingredient (recette_id, ingredient_id, quantite, unite)
    select rid, ing.id, v.quantite, v.unite from (values
    ('filets de poisson blanc', 'viandes-poissons', false, 300, 'g'),
    ('champignons', 'legumes-fruits', false, 1, 'piece'),
    ('crème fraîche', 'produits-frais', false, 20, 'cl'),
    ('beurre', 'produits-frais', true, 30, 'g'),
    ('kubor', 'epicerie', true, 1, 'piece'),
    ('citron', 'legumes-fruits', false, 1, 'piece'),
    ('farine', 'epicerie', true, 2, 'cas'),
    ('sel', 'epicerie', true, 1, 'cac'),
    ('poivre', 'epicerie', true, 1, 'cac'),
    ('tagliatelles', 'epicerie', false, 250, 'g')
    ) as v(nom, categorie, fond, quantite, unite)
    join ingredient ing on ing.nom = v.nom and ing.categorie = v.categorie and ing.fond_de_placard = v.fond;
  insert into recette (nom, temps_preparation, user_id) values ('Saumon riz', 'rapide', null) returning id into rid;
  insert into recette_ingredient (recette_id, ingredient_id, quantite, unite)
    select rid, ing.id, v.quantite, v.unite from (values
    ('pavés de saumon', 'viandes-poissons', false, 2, 'piece'),
    ('riz', 'epicerie', true, 130, 'g')
    ) as v(nom, categorie, fond, quantite, unite)
    join ingredient ing on ing.nom = v.nom and ing.categorie = v.categorie and ing.fond_de_placard = v.fond;
  insert into recette (nom, temps_preparation, user_id) values ('Saumon pâtes curry', 'rapide', null) returning id into rid;
  insert into recette_ingredient (recette_id, ingredient_id, quantite, unite)
    select rid, ing.id, v.quantite, v.unite from (values
    ('pavés de saumon', 'viandes-poissons', false, 2, 'piece'),
    ('fusilli', 'epicerie', false, 250, 'g'),
    ('crème fraîche', 'produits-frais', false, 20, 'cl'),
    ('échalote', 'legumes-fruits', false, 1, 'piece'),
    ('curry en poudre', 'epicerie', true, 1, 'cac'),
    ('sel', 'epicerie', true, 1, 'cac'),
    ('poivre', 'epicerie', true, 1, 'cac')
    ) as v(nom, categorie, fond, quantite, unite)
    join ingredient ing on ing.nom = v.nom and ing.categorie = v.categorie and ing.fond_de_placard = v.fond;
  insert into recette (nom, temps_preparation, user_id) values ('Cordons bleus lentilles', 'rapide', null) returning id into rid;
  insert into recette_ingredient (recette_id, ingredient_id, quantite, unite)
    select rid, ing.id, v.quantite, v.unite from (values
    ('cordons bleus', 'epicerie', false, 4, 'piece'),
    ('lentilles (boite)', 'epicerie', false, 1, 'piece')
    ) as v(nom, categorie, fond, quantite, unite)
    join ingredient ing on ing.nom = v.nom and ing.categorie = v.categorie and ing.fond_de_placard = v.fond;
  insert into recette (nom, temps_preparation, user_id) values ('Beignets de poulet lentilles', 'rapide', null) returning id into rid;
  insert into recette_ingredient (recette_id, ingredient_id, quantite, unite)
    select rid, ing.id, v.quantite, v.unite from (values
    ('beignets de poulet', 'epicerie', false, 200, 'g'),
    ('lentilles (boite)', 'epicerie', false, 1, 'piece')
    ) as v(nom, categorie, fond, quantite, unite)
    join ingredient ing on ing.nom = v.nom and ing.categorie = v.categorie and ing.fond_de_placard = v.fond;
  insert into recette (nom, temps_preparation, user_id) values ('Pâtes bolognaises', 'rapide', null) returning id into rid;
  insert into recette_ingredient (recette_id, ingredient_id, quantite, unite)
    select rid, ing.id, v.quantite, v.unite from (values
    ('penne', 'epicerie', false, 250, 'g'),
    ('boulettes de boeuf', 'surgeles', false, 250, 'g'),
    ('sauce provençale', 'epicerie', false, 400, 'g')
    ) as v(nom, categorie, fond, quantite, unite)
    join ingredient ing on ing.nom = v.nom and ing.categorie = v.categorie and ing.fond_de_placard = v.fond;
  insert into recette (nom, temps_preparation, user_id) values ('Pâtes carbonara', 'rapide', null) returning id into rid;
  insert into recette_ingredient (recette_id, ingredient_id, quantite, unite)
    select rid, ing.id, v.quantite, v.unite from (values
    ('pâtes', 'epicerie', false, 250, 'g'),
    ('lardons', 'viandes-poissons', false, 150, 'g'),
    ('parmesan', 'produits-frais', false, 50, 'g'),
    ('crème fraîche', 'produits-frais', false, 20, 'cl'),
    ('poivre', 'epicerie', true, 1, 'cac')
    ) as v(nom, categorie, fond, quantite, unite)
    join ingredient ing on ing.nom = v.nom and ing.categorie = v.categorie and ing.fond_de_placard = v.fond;
  insert into recette (nom, temps_preparation, user_id) values ('Pâtes pesto', 'rapide', null) returning id into rid;
  insert into recette_ingredient (recette_id, ingredient_id, quantite, unite)
    select rid, ing.id, v.quantite, v.unite from (values
    ('fusilli', 'epicerie', false, 250, 'g'),
    ('pesto', 'produits-frais', false, 3, 'cas'),
    ('parmesan', 'produits-frais', false, 30, 'g')
    ) as v(nom, categorie, fond, quantite, unite)
    join ingredient ing on ing.nom = v.nom and ing.categorie = v.categorie and ing.fond_de_placard = v.fond;
  insert into recette (nom, temps_preparation, user_id) values ('Pâtes au saumon', 'normal', null) returning id into rid;
  insert into recette_ingredient (recette_id, ingredient_id, quantite, unite)
    select rid, ing.id, v.quantite, v.unite from (values
    ('pâtes', 'epicerie', false, 200, 'g'),
    ('pavés de saumon', 'viandes-poissons', false, 2, 'piece'),
    ('crème fraîche', 'produits-frais', false, 20, 'cl'),
    ('échalote', 'legumes-fruits', false, 1, 'piece')
    ) as v(nom, categorie, fond, quantite, unite)
    join ingredient ing on ing.nom = v.nom and ing.categorie = v.categorie and ing.fond_de_placard = v.fond;
  insert into recette (nom, temps_preparation, user_id) values ('Pâtes chorizo', 'normal', null) returning id into rid;
  insert into recette_ingredient (recette_id, ingredient_id, quantite, unite)
    select rid, ing.id, v.quantite, v.unite from (values
    ('penne', 'epicerie', false, 200, 'g'),
    ('chorizo', 'viandes-poissons', false, 0.5, 'piece'),
    ('pulpe de tomates', 'epicerie', false, 1, 'piece'),
    ('échalote', 'legumes-fruits', false, 1, 'piece'),
    ('paprika', 'epicerie', true, 1, 'cac'),
    ('huile d''olive', 'epicerie', true, 1, 'cas'),
    ('kubor', 'epicerie', true, 1, 'piece')
    ) as v(nom, categorie, fond, quantite, unite)
    join ingredient ing on ing.nom = v.nom and ing.categorie = v.categorie and ing.fond_de_placard = v.fond;
  insert into recette (nom, temps_preparation, user_id) values ('Pâtes aux légumes', 'long', null) returning id into rid;
  insert into recette_ingredient (recette_id, ingredient_id, quantite, unite)
    select rid, ing.id, v.quantite, v.unite from (values
    ('pâtes', 'epicerie', false, 250, 'g'),
    ('carottes', 'legumes-fruits', false, 2, 'piece'),
    ('navets boule d''or', 'legumes-fruits', false, 1, 'piece'),
    ('pulpe de tomates', 'epicerie', false, 1, 'piece'),
    ('oignon', 'legumes-fruits', true, 1, 'piece'),
    ('parmesan', 'produits-frais', false, 30, 'g'),
    ('herbes de Provence', 'epicerie', true, 1, 'cac')
    ) as v(nom, categorie, fond, quantite, unite)
    join ingredient ing on ing.nom = v.nom and ing.categorie = v.categorie and ing.fond_de_placard = v.fond;
  insert into recette (nom, temps_preparation, user_id) values ('Lasagnes', 'long', null) returning id into rid;
  insert into recette_ingredient (recette_id, ingredient_id, quantite, unite)
    select rid, ing.id, v.quantite, v.unite from (values
    ('lasagne', 'epicerie', false, 200, 'g'),
    ('viande hachée', 'viandes-poissons', false, 300, 'g'),
    ('sauce provençale', 'epicerie', false, 600, 'g'),
    ('oignon', 'legumes-fruits', true, 1, 'piece'),
    ('lait', 'produits-frais', true, 300, 'ml'),
    ('beurre', 'produits-frais', true, 30, 'g'),
    ('emmental', 'produits-frais', true, 100, 'g'),
    ('huile d''olive', 'epicerie', true, 1, 'cas'),
    ('herbes de Provence', 'epicerie', true, 1, 'cac')
    ) as v(nom, categorie, fond, quantite, unite)
    join ingredient ing on ing.nom = v.nom and ing.categorie = v.categorie and ing.fond_de_placard = v.fond;
  insert into recette (nom, temps_preparation, user_id) values ('Lasagnes chèvre épinards', 'long', null) returning id into rid;
  insert into recette_ingredient (recette_id, ingredient_id, quantite, unite)
    select rid, ing.id, v.quantite, v.unite from (values
    ('lasagne', 'epicerie', false, 200, 'g'),
    ('épinards', 'surgeles', false, 300, 'g'),
    ('buche de chèvre', 'produits-frais', false, 1, 'piece'),
    ('lait', 'produits-frais', true, 500, 'ml'),
    ('beurre', 'produits-frais', true, 50, 'g'),
    ('emmental', 'produits-frais', true, 100, 'g'),
    ('oignon', 'legumes-fruits', true, 1, 'piece'),
    ('muscade', 'epicerie', true, 1, 'cac'),
    ('farine', 'epicerie', true, 2, 'cas'),
    ('sel', 'epicerie', true, 1, 'cac'),
    ('poivre', 'epicerie', true, 1, 'cac')
    ) as v(nom, categorie, fond, quantite, unite)
    join ingredient ing on ing.nom = v.nom and ing.categorie = v.categorie and ing.fond_de_placard = v.fond;
  insert into recette (nom, temps_preparation, user_id) values ('Lasagne reblochon butternut', 'long', null) returning id into rid;
  insert into recette_ingredient (recette_id, ingredient_id, quantite, unite)
    select rid, ing.id, v.quantite, v.unite from (values
    ('feuilles de lasagne', 'epicerie', false, 200, 'g'),
    ('butternut', 'legumes-fruits', false, 400, 'g'),
    ('reblochon', 'produits-frais', false, 200, 'g'),
    ('lardons', 'viandes-poissons', false, 150, 'g'),
    ('lait', 'produits-frais', true, 500, 'ml'),
    ('beurre', 'produits-frais', true, 50, 'g'),
    ('oignon', 'legumes-fruits', true, 1, 'piece'),
    ('farine', 'epicerie', true, 2, 'cas'),
    ('sel', 'epicerie', true, 1, 'cac'),
    ('poivre', 'epicerie', true, 1, 'cac')
    ) as v(nom, categorie, fond, quantite, unite)
    join ingredient ing on ing.nom = v.nom and ing.categorie = v.categorie and ing.fond_de_placard = v.fond;
  insert into recette (nom, temps_preparation, user_id) values ('Gratin ravioles', 'normal', null) returning id into rid;
  insert into recette_ingredient (recette_id, ingredient_id, quantite, unite)
    select rid, ing.id, v.quantite, v.unite from (values
    ('ravioles', 'produits-frais', false, 1, 'sachet'),
    ('blanc de poulet', 'viandes-poissons', false, 2, 'piece'),
    ('crème fraîche semi-épaisse', 'produits-frais', false, 20, 'cl'),
    ('comté', 'produits-frais', false, 100, 'g'),
    ('sel', 'epicerie', true, 1, 'cac'),
    ('pesto', 'produits-frais', false, 4, 'cas'),
    ('poivre', 'epicerie', true, 1, 'cac')
    ) as v(nom, categorie, fond, quantite, unite)
    join ingredient ing on ing.nom = v.nom and ing.categorie = v.categorie and ing.fond_de_placard = v.fond;
  insert into recette (nom, temps_preparation, user_id) values ('Gratin crozets butternut', 'long', null) returning id into rid;
  insert into recette_ingredient (recette_id, ingredient_id, quantite, unite)
    select rid, ing.id, v.quantite, v.unite from (values
    ('crozets', 'epicerie', false, 300, 'g'),
    ('butternut', 'legumes-fruits', false, 400, 'g'),
    ('fromage à raclette', 'produits-frais', false, 80, 'g'),
    ('oignon', 'legumes-fruits', true, 1, 'piece'),
    ('dés de jambon', 'viandes-poissons', false, 150, 'g'),
    ('kubor', 'epicerie', true, 1, 'piece'),
    ('muscade', 'epicerie', true, 1, 'cac'),
    ('sel', 'epicerie', true, 1, 'cac'),
    ('poivre', 'epicerie', true, 1, 'cac')
    ) as v(nom, categorie, fond, quantite, unite)
    join ingredient ing on ing.nom = v.nom and ing.categorie = v.categorie and ing.fond_de_placard = v.fond;
  insert into recette (nom, temps_preparation, user_id) values ('Gratin crozets choux-fleur', 'long', null) returning id into rid;
  insert into recette_ingredient (recette_id, ingredient_id, quantite, unite)
    select rid, ing.id, v.quantite, v.unite from (values
    ('crozets', 'epicerie', false, 300, 'g'),
    ('chou-fleur', 'legumes-fruits', false, 1, 'piece'),
    ('fromage à raclette', 'produits-frais', false, 80, 'g'),
    ('oignon', 'legumes-fruits', true, 1, 'piece'),
    ('dés de jambon', 'viandes-poissons', false, 150, 'g'),
    ('kubor', 'epicerie', true, 1, 'piece'),
    ('muscade', 'epicerie', true, 1, 'cac'),
    ('sel', 'epicerie', true, 1, 'cac'),
    ('poivre', 'epicerie', true, 1, 'cac')
    ) as v(nom, categorie, fond, quantite, unite)
    join ingredient ing on ing.nom = v.nom and ing.categorie = v.categorie and ing.fond_de_placard = v.fond;
  insert into recette (nom, temps_preparation, user_id) values ('Croziflette', 'long', null) returning id into rid;
  insert into recette_ingredient (recette_id, ingredient_id, quantite, unite)
    select rid, ing.id, v.quantite, v.unite from (values
    ('crozets', 'epicerie', false, 200, 'g'),
    ('reblochon', 'produits-frais', false, 200, 'g'),
    ('lardons', 'viandes-poissons', false, 150, 'g'),
    ('oignon', 'legumes-fruits', true, 1, 'piece'),
    ('crème fraîche', 'produits-frais', false, 10, 'cl'),
    ('sel', 'epicerie', true, 1, 'cac'),
    ('poivre', 'epicerie', true, 1, 'cac')
    ) as v(nom, categorie, fond, quantite, unite)
    join ingredient ing on ing.nom = v.nom and ing.categorie = v.categorie and ing.fond_de_placard = v.fond;
  insert into recette (nom, temps_preparation, user_id) values ('Tartiflette', 'long', null) returning id into rid;
  insert into recette_ingredient (recette_id, ingredient_id, quantite, unite)
    select rid, ing.id, v.quantite, v.unite from (values
    ('pommes de terre', 'legumes-fruits', false, 500, 'g'),
    ('reblochon', 'produits-frais', false, 200, 'g'),
    ('lardons', 'viandes-poissons', false, 150, 'g'),
    ('oignon', 'legumes-fruits', true, 1, 'piece'),
    ('sel', 'epicerie', true, 1, 'cac'),
    ('poivre', 'epicerie', true, 1, 'cac')
    ) as v(nom, categorie, fond, quantite, unite)
    join ingredient ing on ing.nom = v.nom and ing.categorie = v.categorie and ing.fond_de_placard = v.fond;
  insert into recette (nom, temps_preparation, user_id) values ('Quiche chèvre épinards', 'long', null) returning id into rid;
  insert into recette_ingredient (recette_id, ingredient_id, quantite, unite)
    select rid, ing.id, v.quantite, v.unite from (values
    ('pâte feuilletée', 'boulangerie', false, 1, 'piece'),
    ('épinards', 'surgeles', false, 200, 'g'),
    ('buche de chèvre', 'produits-frais', false, 1, 'piece'),
    ('œufs', 'produits-frais', false, 3, 'piece'),
    ('crème fraîche semi-épaisse', 'produits-frais', false, 20, 'cl'),
    ('lait', 'produits-frais', true, 200, 'ml'),
    ('parmesan', 'produits-frais', false, 100, 'g'),
    ('sel', 'epicerie', true, 1, 'cac'),
    ('poivre', 'epicerie', true, 1, 'cac')
    ) as v(nom, categorie, fond, quantite, unite)
    join ingredient ing on ing.nom = v.nom and ing.categorie = v.categorie and ing.fond_de_placard = v.fond;
  insert into recette (nom, temps_preparation, user_id) values ('Quiche lorraine', 'long', null) returning id into rid;
  insert into recette_ingredient (recette_id, ingredient_id, quantite, unite)
    select rid, ing.id, v.quantite, v.unite from (values
    ('pâte feuilletée', 'boulangerie', false, 1, 'piece'),
    ('lardons', 'viandes-poissons', false, 200, 'g'),
    ('œufs', 'produits-frais', false, 3, 'piece'),
    ('crème fraîche', 'produits-frais', false, 20, 'cl'),
    ('lait', 'produits-frais', true, 200, 'ml'),
    ('emmental', 'produits-frais', true, 100, 'g'),
    ('muscade', 'epicerie', true, 1, 'cac'),
    ('sel', 'epicerie', true, 1, 'cac'),
    ('poivre', 'epicerie', true, 1, 'cac')
    ) as v(nom, categorie, fond, quantite, unite)
    join ingredient ing on ing.nom = v.nom and ing.categorie = v.categorie and ing.fond_de_placard = v.fond;
  insert into recette (nom, temps_preparation, user_id) values ('Feuilleté chèvre jambon', 'rapide', null) returning id into rid;
  insert into recette_ingredient (recette_id, ingredient_id, quantite, unite)
    select rid, ing.id, v.quantite, v.unite from (values
    ('pâte feuilletée', 'boulangerie', false, 1, 'piece'),
    ('jambon cru (tranches)', 'viandes-poissons', false, 4, 'piece'),
    ('buche de chèvre', 'produits-frais', false, 1, 'piece')
    ) as v(nom, categorie, fond, quantite, unite)
    join ingredient ing on ing.nom = v.nom and ing.categorie = v.categorie and ing.fond_de_placard = v.fond;
  insert into recette (nom, temps_preparation, user_id) values ('Feuilleté mozza pesto', 'rapide', null) returning id into rid;
  insert into recette_ingredient (recette_id, ingredient_id, quantite, unite)
    select rid, ing.id, v.quantite, v.unite from (values
    ('pâte feuilletée', 'boulangerie', false, 1, 'piece'),
    ('mozzarella', 'produits-frais', false, 125, 'g'),
    ('pesto', 'produits-frais', false, 2, 'cas')
    ) as v(nom, categorie, fond, quantite, unite)
    join ingredient ing on ing.nom = v.nom and ing.categorie = v.categorie and ing.fond_de_placard = v.fond;
  insert into recette (nom, temps_preparation, user_id) values ('Tarte tomates', 'normal', null) returning id into rid;
  insert into recette_ingredient (recette_id, ingredient_id, quantite, unite)
    select rid, ing.id, v.quantite, v.unite from (values
    ('pâte feuilletée', 'boulangerie', false, 1, 'piece'),
    ('tomates', 'legumes-fruits', false, 3, 'piece'),
    ('oignon', 'legumes-fruits', true, 1, 'piece'),
    ('moutarde', 'epicerie', true, 2, 'cas'),
    ('emmental', 'produits-frais', true, 100, 'g'),
    ('herbes de Provence', 'epicerie', true, 1, 'cas'),
    ('poivre', 'epicerie', true, 1, 'cac')
    ) as v(nom, categorie, fond, quantite, unite)
    join ingredient ing on ing.nom = v.nom and ing.categorie = v.categorie and ing.fond_de_placard = v.fond;
  insert into recette (nom, temps_preparation, user_id) values ('Tarte thon tomates', 'normal', null) returning id into rid;
  insert into recette_ingredient (recette_id, ingredient_id, quantite, unite)
    select rid, ing.id, v.quantite, v.unite from (values
    ('pâte feuilletée', 'boulangerie', false, 1, 'piece'),
    ('tomates', 'legumes-fruits', false, 3, 'piece'),
    ('thon en boite', 'epicerie', false, 1, 'piece'),
    ('moutarde', 'epicerie', true, 2, 'cas'),
    ('emmental', 'produits-frais', true, 100, 'g'),
    ('herbes de Provence', 'epicerie', true, 1, 'cas'),
    ('poivre', 'epicerie', true, 1, 'cac')
    ) as v(nom, categorie, fond, quantite, unite)
    join ingredient ing on ing.nom = v.nom and ing.categorie = v.categorie and ing.fond_de_placard = v.fond;
  insert into recette (nom, temps_preparation, user_id) values ('Wraps', 'rapide', null) returning id into rid;
  insert into recette_ingredient (recette_id, ingredient_id, quantite, unite)
    select rid, ing.id, v.quantite, v.unite from (values
    ('wraps', 'boulangerie', false, 6, 'piece'),
    ('jambon blanc (tranche)', 'viandes-poissons', false, 6, 'piece'),
    ('tomates', 'legumes-fruits', false, 1, 'piece'),
    ('tartare', 'produits-frais', false, 200, 'g'),
    ('sel', 'epicerie', true, 1, 'cac'),
    ('poivre', 'epicerie', true, 1, 'cac')
    ) as v(nom, categorie, fond, quantite, unite)
    join ingredient ing on ing.nom = v.nom and ing.categorie = v.categorie and ing.fond_de_placard = v.fond;
  insert into recette (nom, temps_preparation, user_id) values ('Bun''s frites', 'rapide', null) returning id into rid;
  insert into recette_ingredient (recette_id, ingredient_id, quantite, unite)
    select rid, ing.id, v.quantite, v.unite from (values
    ('bun''s ketchup', 'boulangerie', false, 4, 'piece'),
    ('frites', 'surgeles', false, 600, 'g')
    ) as v(nom, categorie, fond, quantite, unite)
    join ingredient ing on ing.nom = v.nom and ing.categorie = v.categorie and ing.fond_de_placard = v.fond;
  insert into recette (nom, temps_preparation, user_id) values ('Burger maison frites', 'long', null) returning id into rid;
  insert into recette_ingredient (recette_id, ingredient_id, quantite, unite)
    select rid, ing.id, v.quantite, v.unite from (values
    ('pain burger', 'boulangerie', false, 2, 'piece'),
    ('steaks hachés', 'surgeles', false, 300, 'g'),
    ('frites', 'surgeles', false, 600, 'g'),
    ('emmental', 'produits-frais', true, 60, 'g'),
    ('tomates', 'legumes-fruits', false, 1, 'piece'),
    ('oignon', 'legumes-fruits', true, 1, 'piece'),
    ('ketchup', 'epicerie', false, 2, 'cas'),
    ('huile', 'epicerie', true, 500, 'ml'),
    ('mayonnaise', 'epicerie', true, 1, 'cas'),
    ('sel', 'epicerie', true, 1, 'cac'),
    ('poivre', 'epicerie', true, 1, 'cac')
    ) as v(nom, categorie, fond, quantite, unite)
    join ingredient ing on ing.nom = v.nom and ing.categorie = v.categorie and ing.fond_de_placard = v.fond;
  insert into recette (nom, temps_preparation, user_id) values ('Croustibat riz', 'normal', null) returning id into rid;
  insert into recette_ingredient (recette_id, ingredient_id, quantite, unite)
    select rid, ing.id, v.quantite, v.unite from (values
    ('croustibat', 'surgeles', false, 1, 'piece'),
    ('riz', 'epicerie', true, 130, 'g')
    ) as v(nom, categorie, fond, quantite, unite)
    join ingredient ing on ing.nom = v.nom and ing.categorie = v.categorie and ing.fond_de_placard = v.fond;
  insert into recette (nom, temps_preparation, user_id) values ('Croissant jambon', 'rapide', null) returning id into rid;
  insert into recette_ingredient (recette_id, ingredient_id, quantite, unite)
    select rid, ing.id, v.quantite, v.unite from (values
    ('croissants', 'boulangerie', false, 4, 'piece'),
    ('jambon blanc (tranche)', 'viandes-poissons', false, 4, 'piece'),
    ('emmental', 'produits-frais', true, 100, 'g')
    ) as v(nom, categorie, fond, quantite, unite)
    join ingredient ing on ing.nom = v.nom and ing.categorie = v.categorie and ing.fond_de_placard = v.fond;
  insert into recette (nom, temps_preparation, user_id) values ('Brownie brocolis', 'normal', null) returning id into rid;
  insert into recette_ingredient (recette_id, ingredient_id, quantite, unite)
    select rid, ing.id, v.quantite, v.unite from (values
    ('brocolis', 'legumes-fruits', false, 1, 'piece'),
    ('œufs', 'produits-frais', false, 2, 'piece'),
    ('dés de jambon', 'viandes-poissons', false, 150, 'g'),
    ('comté', 'produits-frais', false, 80, 'g'),
    ('lait', 'produits-frais', true, 250, 'ml'),
    ('feta', 'produits-frais', false, 0.5, 'piece'),
    ('farine', 'epicerie', true, 160, 'g'),
    ('sel', 'epicerie', true, 1, 'cac'),
    ('levure chimique', 'epicerie', true, 1, 'cac'),
    ('poivre', 'epicerie', true, 1, 'cac')
    ) as v(nom, categorie, fond, quantite, unite)
    join ingredient ing on ing.nom = v.nom and ing.categorie = v.categorie and ing.fond_de_placard = v.fond;
  insert into recette (nom, temps_preparation, user_id) values ('Dal lentilles', 'normal', null) returning id into rid;
  insert into recette_ingredient (recette_id, ingredient_id, quantite, unite)
    select rid, ing.id, v.quantite, v.unite from (values
    ('lentilles corail', 'epicerie', false, 300, 'g'),
    ('lait de coco', 'epicerie', false, 200, 'ml'),
    ('pulpe de tomates', 'epicerie', false, 1, 'piece'),
    ('échalote', 'legumes-fruits', false, 4, 'piece'),
    ('gingembre', 'epicerie', true, 1, 'cac'),
    ('ail', 'legumes-fruits', true, 3, 'piece'),
    ('coriandre', 'epicerie', true, 1, 'cac'),
    ('curcuma', 'epicerie', true, 1, 'cac'),
    ('cumin', 'epicerie', true, 1, 'cac'),
    ('kubor', 'epicerie', true, 1, 'piece'),
    ('huile d''olive', 'epicerie', true, 1, 'cas'),
    ('moutarde à l''ancienne', 'epicerie', true, 1, 'cac')
    ) as v(nom, categorie, fond, quantite, unite)
    join ingredient ing on ing.nom = v.nom and ing.categorie = v.categorie and ing.fond_de_placard = v.fond;
  insert into recette (nom, temps_preparation, user_id) values ('Taboulé', 'normal', null) returning id into rid;
  insert into recette_ingredient (recette_id, ingredient_id, quantite, unite)
    select rid, ing.id, v.quantite, v.unite from (values
    ('taboulé', 'epicerie', false, 1, 'sachet'),
    ('tomates', 'legumes-fruits', false, 3, 'piece'),
    ('concombre', 'legumes-fruits', false, 1, 'piece'),
    ('poivron rouge', 'legumes-fruits', false, 1, 'piece')
    ) as v(nom, categorie, fond, quantite, unite)
    join ingredient ing on ing.nom = v.nom and ing.categorie = v.categorie and ing.fond_de_placard = v.fond;
  insert into recette (nom, temps_preparation, user_id) values ('Paella surgelée', 'rapide', null) returning id into rid;
  insert into recette_ingredient (recette_id, ingredient_id, quantite, unite)
    select rid, ing.id, v.quantite, v.unite from (values
    ('paella surgelée', 'surgeles', false, 600, 'g')
    ) as v(nom, categorie, fond, quantite, unite)
    join ingredient ing on ing.nom = v.nom and ing.categorie = v.categorie and ing.fond_de_placard = v.fond;
  insert into recette (nom, temps_preparation, user_id) values ('Curry végétarien', 'long', null) returning id into rid;
  insert into recette_ingredient (recette_id, ingredient_id, quantite, unite)
    select rid, ing.id, v.quantite, v.unite from (values
    ('patates douces', 'legumes-fruits', false, 1, 'piece'),
    ('courgette', 'legumes-fruits', false, 1, 'piece'),
    ('carottes', 'legumes-fruits', false, 2, 'piece'),
    ('pulpe de tomates', 'epicerie', false, 1, 'piece'),
    ('lait de coco', 'epicerie', false, 200, 'ml'),
    ('oignon', 'legumes-fruits', true, 1, 'piece'),
    ('gingembre', 'epicerie', true, 1, 'cac'),
    ('ail', 'legumes-fruits', true, 2, 'piece'),
    ('pate de curry', 'epicerie', false, 3, 'cac'),
    ('jus de citron', 'epicerie', true, 1, 'cac'),
    ('cumin', 'epicerie', true, 1, 'cac'),
    ('huile d''olive', 'epicerie', true, 1, 'cas'),
    ('sel', 'epicerie', true, 1, 'cac'),
    ('riz basmati', 'epicerie', true, 130, 'g')
    ) as v(nom, categorie, fond, quantite, unite)
    join ingredient ing on ing.nom = v.nom and ing.categorie = v.categorie and ing.fond_de_placard = v.fond;
  insert into recette (nom, temps_preparation, user_id) values ('Bruschetta', 'rapide', null) returning id into rid;
  insert into recette_ingredient (recette_id, ingredient_id, quantite, unite)
    select rid, ing.id, v.quantite, v.unite from (values
    ('pain tranché', 'boulangerie', false, 6, 'piece'),
    ('tomates', 'legumes-fruits', false, 2, 'piece'),
    ('jambon cru (tranches)', 'viandes-poissons', false, 6, 'piece'),
    ('buche de chèvre', 'produits-frais', false, 1, 'piece'),
    ('huile d''olive', 'epicerie', true, 3, 'cas'),
    ('poivre', 'epicerie', true, 1, 'cac')
    ) as v(nom, categorie, fond, quantite, unite)
    join ingredient ing on ing.nom = v.nom and ing.categorie = v.categorie and ing.fond_de_placard = v.fond;
  insert into recette (nom, temps_preparation, user_id) values ('Salade César', 'rapide', null) returning id into rid;
  insert into recette_ingredient (recette_id, ingredient_id, quantite, unite)
    select rid, ing.id, v.quantite, v.unite from (values
    ('émincé de poulet', 'viandes-poissons', false, 200, 'g'),
    ('laitue iceberg', 'legumes-fruits', false, 1, 'piece'),
    ('parmesan (copeaux)', 'produits-frais', false, 40, 'g'),
    ('croûtons', 'boulangerie', false, 50, 'g'),
    ('maïs', 'epicerie', false, 1, 'piece'),
    ('œufs', 'produits-frais', false, 2, 'piece'),
    ('tomates', 'legumes-fruits', false, 2, 'piece'),
    ('sauce césar', 'epicerie', false, 1, 'piece')
    ) as v(nom, categorie, fond, quantite, unite)
    join ingredient ing on ing.nom = v.nom and ing.categorie = v.categorie and ing.fond_de_placard = v.fond;
  insert into recette (nom, temps_preparation, user_id) values ('Omelette', 'rapide', null) returning id into rid;
  insert into recette_ingredient (recette_id, ingredient_id, quantite, unite)
    select rid, ing.id, v.quantite, v.unite from (values
    ('œufs', 'produits-frais', false, 6, 'piece'),
    ('emmental', 'produits-frais', true, 50, 'g')
    ) as v(nom, categorie, fond, quantite, unite)
    join ingredient ing on ing.nom = v.nom and ing.categorie = v.categorie and ing.fond_de_placard = v.fond;
  insert into recette (nom, temps_preparation, user_id) values ('Poireaux jambon', 'long', null) returning id into rid;
  insert into recette_ingredient (recette_id, ingredient_id, quantite, unite)
    select rid, ing.id, v.quantite, v.unite from (values
    ('poireaux', 'legumes-fruits', false, 4, 'piece'),
    ('jambon blanc (tranche)', 'viandes-poissons', false, 4, 'piece'),
    ('emmental', 'produits-frais', true, 80, 'g'),
    ('beurre', 'produits-frais', true, 50, 'g'),
    ('lait', 'produits-frais', true, 500, 'ml'),
    ('farine', 'epicerie', true, 2, 'cas'),
    ('muscade', 'epicerie', true, 1, 'cac')
    ) as v(nom, categorie, fond, quantite, unite)
    join ingredient ing on ing.nom = v.nom and ing.categorie = v.categorie and ing.fond_de_placard = v.fond;
end $$;
