-- Migration — catalogue de recettes publiques (#269), remplacement du
-- catalogue global initial (seedé perso par #2) par un catalogue de 154
-- recettes destiné au grand public (quotidien/familial, classiques du
-- dimanche français, cuisine du monde), avec vegetarien/accompagnement/
-- saisons/etapes rédigés directement (pas de passe heuristique post-seed).
--
-- Générée en 2 temps : le corps "insert ingredient / insert recette" est
-- généré par `node scripts/generer-seed-recettes.mjs --fragment` depuis
-- data/recettes.json (ne pas éditer cette section à la main — régénérer le
-- script si le catalogue évolue). Le reste (résolution du foyer d'Arnaud,
-- réassignation, masquage) est écrit à la main autour de ce fragment.
--
-- ⚠️ PIÈGE central (ordre du bloc) : les 3 étapes ci-dessous s'exécutent
-- dans CE bloc do $$ ... $$ unique, DANS CET ORDRE, et c'est cet ordre qui
-- garantit la sécurité SANS avoir à lister des ids/noms :
--   1. Reconversion : à ce stade, seules les recettes de l'ANCIEN catalogue
--      (#2, foyer_id IS NULL) existent → on les réassigne au foyer et au
--      compte d'Arnaud Solente (arnaud.solente@gmail.com). Elles restent
--      intactes, éditables, dans son espace perso ; aucun impact FK (ids
--      inchangés, ses plannings persistés continuent de pointer dessus).
--   2. Insertion des 154 nouvelles recettes globales (foyer_id/user_id NULL
--      par défaut mon_foyer(), qui vaut NULL en contexte migration).
--   3. Masquage ciblé : à ce stade, SEULES les nouvelles recettes ont
--      foyer_id IS NULL (les anciennes ont été réassignées à l'étape 1) →
--      la jointure `where foyer_id is null` cible exactement les 154
--      nouvelles, sans avoir besoin de filtrer par id/nom.
--
-- ⚠️ Portabilité staging/prod : la résolution du foyer par email renvoie
-- NULL si ce compte n'existe pas dans l'environnement cible (ex. staging,
-- qui n'a pas le compte personnel d'Arnaud) → les étapes 1 et 3 deviennent
-- alors des no-op silencieux, sans erreur. Seule la prod (où ce compte
-- existe) applique réellement la reconversion + le masquage.
--
-- ⚠️ RLS : inchangée par cette migration. Les policies "recette: lecture
-- globale ou foyer" / "recette_masquee: lecture|insertion|suppression foyer"
-- posées par #56 PR2 couvrent déjà ce nouveau catalogue (foyer_id IS NULL =
-- global, cf. cette migration).

do $$
declare
  rid uuid;
  v_foyer_arnaud uuid;
  v_user_arnaud uuid;
begin
  -- Garde-fou idempotent : ne rien faire si ce catalogue est déjà seedé
  -- (évite une double insertion en cas de rejeu manuel en dev).
  if exists (select 1 from recette where nom = 'Pâtes à la carbonara') then
    return;
  end if;

  -- Résolution du foyer/compte d'Arnaud par email (profiles n'a pas de
  -- colonne email — jointure via auth.users). NULL si ce compte n'existe
  -- pas dans cet environnement (ex. staging).
  select p.foyer_id, p.user_id into v_foyer_arnaud, v_user_arnaud
  from profiles p
  join auth.users u on u.id = p.user_id
  where u.email = 'arnaud.solente@gmail.com';

  -- 1. Reconversion de l'ancien catalogue (#2) en recettes DU FOYER d'Arnaud.
  if v_foyer_arnaud is not null then
    update recette
      set foyer_id = v_foyer_arnaud, user_id = v_user_arnaud
      where foyer_id is null;
  end if;

  -- 2. Nouveau catalogue global (154 recettes) — fragment généré.
  -- Ingrédients distincts du catalogue.
  insert into ingredient (nom, categorie, fond_de_placard) values
    ('spaghetti', 'epicerie', true),
    ('lardons', 'viandes-poissons', false),
    ('œufs', 'produits-frais', false),
    ('parmesan', 'produits-frais', false),
    ('poivre', 'epicerie', true),
    ('tagliatelles', 'epicerie', true),
    ('pesto', 'epicerie', false),
    ('pignons de pin', 'epicerie', true),
    ('fromage râpé', 'produits-frais', false),
    ('beurre', 'produits-frais', true),
    ('sel', 'epicerie', true),
    ('champignons de Paris', 'legumes-fruits', false),
    ('persil', 'legumes-fruits', false),
    ('riz basmati', 'epicerie', true),
    ('petits pois', 'surgeles', true),
    ('jambon', 'viandes-poissons', false),
    ('sauce soja', 'epicerie', true),
    ('pain de mie', 'boulangerie', true),
    ('laitue romaine', 'legumes-fruits', false),
    ('blanc de poulet', 'viandes-poissons', false),
    ('croûtons', 'boulangerie', true),
    ('sauce César', 'epicerie', false),
    ('tomates', 'legumes-fruits', false),
    ('mozzarella', 'produits-frais', false),
    ('basilic', 'legumes-fruits', false),
    ('huile d''olive', 'epicerie', true),
    ('tortillas de blé', 'boulangerie', true),
    ('salade verte', 'legumes-fruits', false),
    ('sauce fromage blanc', 'produits-frais', false),
    ('pâte brisée', 'boulangerie', true),
    ('crème fraîche', 'produits-frais', false),
    ('poireaux', 'legumes-fruits', false),
    ('steak haché', 'viandes-poissons', false),
    ('pommes de terre', 'legumes-fruits', true),
    ('huile de tournesol', 'epicerie', true),
    ('courgettes', 'legumes-fruits', false),
    ('poivrons', 'legumes-fruits', false),
    ('tofu ferme', 'produits-frais', false),
    ('bœuf haché', 'viandes-poissons', false),
    ('sauce tomate', 'epicerie', true),
    ('oignon', 'legumes-fruits', true),
    ('penne', 'epicerie', true),
    ('ail', 'legumes-fruits', true),
    ('coquillettes', 'epicerie', true),
    ('thon au naturel', 'viandes-poissons', true),
    ('tomates cerises', 'legumes-fruits', false),
    ('maïs', 'epicerie', true),
    ('vinaigrette', 'epicerie', true),
    ('ananas en tranches', 'epicerie', false),
    ('bacon', 'viandes-poissons', false),
    ('mayonnaise', 'epicerie', true),
    ('filets de poisson panés', 'surgeles', true),
    ('filet de cabillaud', 'viandes-poissons', false),
    ('citron', 'legumes-fruits', false),
    ('filet de porc', 'viandes-poissons', false),
    ('lait de coco', 'epicerie', true),
    ('curry en poudre', 'epicerie', true),
    ('escalope de dinde', 'viandes-poissons', false),
    ('escalope de poulet panée', 'viandes-poissons', false),
    ('lait', 'produits-frais', false),
    ('lentilles vertes cuites', 'epicerie', true),
    ('fromage de chèvre', 'produits-frais', false),
    ('pain de campagne', 'boulangerie', true),
    ('semoule', 'epicerie', true),
    ('menthe fraîche', 'legumes-fruits', false),
    ('concombre', 'legumes-fruits', false),
    ('carottes', 'legumes-fruits', true),
    ('crevettes décortiquées', 'surgeles', true),
    ('pois chiches cuits', 'epicerie', true),
    ('cumin', 'epicerie', true),
    ('farine', 'epicerie', true),
    ('pain à burger', 'boulangerie', true),
    ('cheddar', 'produits-frais', false),
    ('galette végétale', 'surgeles', false),
    ('feta', 'produits-frais', false),
    ('olives noires', 'epicerie', false),
    ('poivron rouge', 'legumes-fruits', false),
    ('légumes de saison', 'legumes-fruits', false),
    ('bouillon de légumes', 'epicerie', true),
    ('gambas', 'surgeles', true),
    ('aubergine', 'legumes-fruits', false),
    ('bœuf en lanières', 'viandes-poissons', false),
    ('pavé de saumon', 'viandes-poissons', false),
    ('haricots verts', 'surgeles', true),
    ('quinoa', 'epicerie', true),
    ('miel', 'epicerie', true),
    ('noix', 'epicerie', true),
    ('poulet entier', 'viandes-poissons', false),
    ('thym', 'legumes-fruits', true),
    ('cuisses de poulet', 'viandes-poissons', false),
    ('sauté de veau', 'viandes-poissons', false),
    ('bouillon de volaille', 'epicerie', true),
    ('riz à risotto', 'epicerie', true),
    ('bouillon de poisson', 'epicerie', true),
    ('abricots secs', 'epicerie', true),
    ('épices à tajine', 'epicerie', true),
    ('merguez', 'viandes-poissons', false),
    ('agneau en morceaux', 'viandes-poissons', false),
    ('pois chiches', 'epicerie', true),
    ('épices à couscous', 'epicerie', true),
    ('sucre roux', 'epicerie', true),
    ('saumon fumé', 'viandes-poissons', false),
    ('plaques de lasagnes', 'epicerie', true),
    ('béchamel', 'epicerie', false),
    ('aubergines', 'legumes-fruits', false),
    ('agneau haché', 'viandes-poissons', false),
    ('cuisses de canard confites', 'viandes-poissons', false),
    ('filet de poisson blanc', 'viandes-poissons', false),
    ('citron confit', 'epicerie', false),
    ('olives vertes', 'epicerie', false),
    ('filet mignon de porc', 'viandes-poissons', false),
    ('moutarde', 'epicerie', true),
    ('halloumi', 'produits-frais', false),
    ('gnocchis', 'epicerie', true),
    ('burrata', 'produits-frais', false),
    ('vin blanc', 'epicerie', true),
    ('fruits de mer surgelés', 'surgeles', true),
    ('endives', 'legumes-fruits', false),
    ('chou-fleur', 'legumes-fruits', false),
    ('chou vert', 'legumes-fruits', false),
    ('falafels', 'surgeles', false),
    ('houmous', 'epicerie', false),
    ('pain pita', 'boulangerie', true),
    ('macaronis', 'epicerie', true),
    ('bœuf à braiser', 'viandes-poissons', false),
    ('bouillon de bœuf', 'epicerie', true),
    ('rôti de bœuf', 'viandes-poissons', false),
    ('épaule d''agneau', 'viandes-poissons', false),
    ('flageolets', 'epicerie', true),
    ('poule', 'viandes-poissons', false),
    ('navets', 'legumes-fruits', false),
    ('jarret de veau', 'viandes-poissons', false),
    ('tomates concassées', 'epicerie', true),
    ('joues de bœuf', 'viandes-poissons', false),
    ('vin rouge', 'epicerie', true),
    ('poulet', 'viandes-poissons', false),
    ('crevettes', 'surgeles', true),
    ('moules', 'viandes-poissons', false),
    ('safran', 'epicerie', true),
    ('artichauts', 'epicerie', false),
    ('rôti de porc', 'viandes-poissons', false),
    ('haricots blancs', 'epicerie', true),
    ('saucisse de Toulouse', 'viandes-poissons', false),
    ('confit de canard', 'viandes-poissons', false),
    ('lard fumé', 'viandes-poissons', false),
    ('pâte feuilletée', 'boulangerie', true),
    ('œuf', 'produits-frais', false),
    ('courge butternut', 'legumes-fruits', false),
    ('épaule d''agneau en morceaux', 'viandes-poissons', false),
    ('veau à blanquette', 'viandes-poissons', false),
    ('morilles séchées', 'epicerie', true),
    ('vin jaune', 'epicerie', false),
    ('rôti de veau', 'viandes-poissons', false),
    ('carottes nouvelles', 'legumes-fruits', false),
    ('pommes de terre nouvelles', 'legumes-fruits', false),
    ('cuisses de canard', 'viandes-poissons', false),
    ('lapin en morceaux', 'viandes-poissons', false),
    ('plat de côtes', 'viandes-poissons', false),
    ('bœuf à bourguignon', 'viandes-poissons', false),
    ('poulet fermier', 'viandes-poissons', false),
    ('gigot d''agneau', 'viandes-poissons', false),
    ('romarin', 'legumes-fruits', true),
    ('choucroute crue', 'legumes-fruits', false),
    ('saucisses fumées', 'viandes-poissons', false),
    ('poitrine fumée', 'viandes-poissons', false),
    ('lentilles vertes', 'epicerie', true),
    ('reblochon', 'produits-frais', false),
    ('mouton en morceaux', 'viandes-poissons', false),
    ('bouquet garni', 'legumes-fruits', true),
    ('veau en morceaux', 'viandes-poissons', false),
    ('rôti d''agneau', 'viandes-poissons', false),
    ('fromage à raclette', 'produits-frais', false),
    ('charcuterie assortie', 'viandes-poissons', false),
    ('cornichons', 'epicerie', true),
    ('tome fraîche de Cantal', 'produits-frais', false),
    ('mont d''or', 'produits-frais', false),
    ('comté', 'produits-frais', false),
    ('beaufort', 'produits-frais', false),
    ('nouilles chinoises', 'epicerie', true),
    ('tortillas de maïs', 'boulangerie', true),
    ('épices à tacos', 'epicerie', true),
    ('gingembre', 'legumes-fruits', true),
    ('sauce au yaourt', 'produits-frais', false),
    ('haricots rouges', 'epicerie', true),
    ('piment en poudre', 'epicerie', true),
    ('épinards', 'legumes-fruits', false),
    ('garam masala', 'epicerie', true),
    ('yaourt nature', 'produits-frais', false),
    ('épices tandoori', 'epicerie', true),
    ('basilic thaï', 'legumes-fruits', false),
    ('sauce nuoc-mâm', 'epicerie', true),
    ('nouilles de riz', 'epicerie', true),
    ('cacahuètes', 'epicerie', true),
    ('épices à fajitas', 'epicerie', true),
    ('lentilles corail', 'epicerie', true),
    ('bloc de curry japonais', 'epicerie', true),
    ('nouilles ramen', 'epicerie', true),
    ('poitrine de porc', 'viandes-poissons', false),
    ('bouillon dashi', 'epicerie', true),
    ('champignons shiitake', 'legumes-fruits', false),
    ('pâte à empanadas', 'boulangerie', true),
    ('pruneaux', 'epicerie', true),
    ('paprika', 'epicerie', true),
    ('haricots noirs', 'epicerie', true),
    ('saucisse fumée', 'viandes-poissons', false),
    ('pâte de curry massaman', 'epicerie', true),
    ('épices korma', 'epicerie', true);

  -- Recettes globales + leurs liens ingrédients.
  insert into recette (nom, temps_preparation, vegetarien, accompagnement, saisons, etapes, user_id) values ('Pâtes à la carbonara', 'rapide', false, 'feculents', null, array['Faire cuire les spaghetti dans l''eau bouillante salée.', 'Faire revenir les lardons à sec dans une poêle.', 'Battre les œufs avec le parmesan et le poivre.', 'Hors du feu, mélanger les pâtes égouttées, les lardons et l''appareil aux œufs.'], null) returning id into rid;
  insert into recette_ingredient (recette_id, ingredient_id, quantite, unite)
    select rid, ing.id, v.quantite, v.unite from (values
    ('spaghetti', 'epicerie', true, 200, 'g'),
    ('lardons', 'viandes-poissons', false, 150, 'g'),
    ('œufs', 'produits-frais', false, 2, 'piece'),
    ('parmesan', 'produits-frais', false, 50, 'g'),
    ('poivre', 'epicerie', true, 1, 'cac')
    ) as v(nom, categorie, fond, quantite, unite)
    join ingredient ing on ing.nom = v.nom and ing.categorie = v.categorie and ing.fond_de_placard = v.fond;
  insert into recette (nom, temps_preparation, vegetarien, accompagnement, saisons, etapes, user_id) values ('Pâtes au pesto', 'rapide', true, 'feculents', null, array['Cuire les tagliatelles.', 'Égoutter en gardant un peu d''eau de cuisson.', 'Mélanger avec le pesto et un filet d''eau de cuisson.', 'Parsemer de parmesan et de pignons.'], null) returning id into rid;
  insert into recette_ingredient (recette_id, ingredient_id, quantite, unite)
    select rid, ing.id, v.quantite, v.unite from (values
    ('tagliatelles', 'epicerie', true, 200, 'g'),
    ('pesto', 'epicerie', false, 100, 'g'),
    ('parmesan', 'produits-frais', false, 30, 'g'),
    ('pignons de pin', 'epicerie', true, 20, 'g')
    ) as v(nom, categorie, fond, quantite, unite)
    join ingredient ing on ing.nom = v.nom and ing.categorie = v.categorie and ing.fond_de_placard = v.fond;
  insert into recette (nom, temps_preparation, vegetarien, accompagnement, saisons, etapes, user_id) values ('Omelette au fromage', 'rapide', true, null, null, array['Battre les œufs avec le sel.', 'Faire fondre le beurre dans une poêle.', 'Verser les œufs, ajouter le fromage à mi-cuisson.', 'Plier l''omelette et servir.'], null) returning id into rid;
  insert into recette_ingredient (recette_id, ingredient_id, quantite, unite)
    select rid, ing.id, v.quantite, v.unite from (values
    ('œufs', 'produits-frais', false, 6, 'piece'),
    ('fromage râpé', 'produits-frais', false, 100, 'g'),
    ('beurre', 'produits-frais', true, 20, 'g'),
    ('sel', 'epicerie', true, 1, 'cac')
    ) as v(nom, categorie, fond, quantite, unite)
    join ingredient ing on ing.nom = v.nom and ing.categorie = v.categorie and ing.fond_de_placard = v.fond;
  insert into recette (nom, temps_preparation, vegetarien, accompagnement, saisons, etapes, user_id) values ('Omelette forestière', 'rapide', true, null, array['automne'], array['Faire revenir les champignons émincés dans le beurre.', 'Battre les œufs, saler, poivrer.', 'Verser sur les champignons et cuire l''omelette.', 'Parsemer de persil ciselé avant de servir.'], null) returning id into rid;
  insert into recette_ingredient (recette_id, ingredient_id, quantite, unite)
    select rid, ing.id, v.quantite, v.unite from (values
    ('œufs', 'produits-frais', false, 6, 'piece'),
    ('champignons de Paris', 'legumes-fruits', false, 200, 'g'),
    ('beurre', 'produits-frais', true, 20, 'g'),
    ('persil', 'legumes-fruits', false, 1, 'piece')
    ) as v(nom, categorie, fond, quantite, unite)
    join ingredient ing on ing.nom = v.nom and ing.categorie = v.categorie and ing.fond_de_placard = v.fond;
  insert into recette (nom, temps_preparation, vegetarien, accompagnement, saisons, etapes, user_id) values ('Riz cantonais', 'rapide', false, 'feculents', null, array['Cuire le riz puis le laisser refroidir.', 'Faire une omelette brouillée légère et la réserver en morceaux.', 'Faire sauter le riz, les petits pois et le jambon à la poêle.', 'Ajouter l''œuf brouillé et la sauce soja, mélanger.'], null) returning id into rid;
  insert into recette_ingredient (recette_id, ingredient_id, quantite, unite)
    select rid, ing.id, v.quantite, v.unite from (values
    ('riz basmati', 'epicerie', true, 200, 'g'),
    ('œufs', 'produits-frais', false, 2, 'piece'),
    ('petits pois', 'surgeles', true, 100, 'g'),
    ('jambon', 'viandes-poissons', false, 100, 'g'),
    ('sauce soja', 'epicerie', true, 2, 'cas')
    ) as v(nom, categorie, fond, quantite, unite)
    join ingredient ing on ing.nom = v.nom and ing.categorie = v.categorie and ing.fond_de_placard = v.fond;
  insert into recette (nom, temps_preparation, vegetarien, accompagnement, saisons, etapes, user_id) values ('Croque-monsieur', 'rapide', false, null, null, array['Beurrer les tranches de pain.', 'Garnir de jambon et de fromage.', 'Refermer les croque-monsieur.', 'Faire dorer à la poêle ou au four des deux côtés.'], null) returning id into rid;
  insert into recette_ingredient (recette_id, ingredient_id, quantite, unite)
    select rid, ing.id, v.quantite, v.unite from (values
    ('pain de mie', 'boulangerie', true, 4, 'piece'),
    ('jambon', 'viandes-poissons', false, 4, 'piece'),
    ('fromage râpé', 'produits-frais', false, 150, 'g'),
    ('beurre', 'produits-frais', true, 20, 'g')
    ) as v(nom, categorie, fond, quantite, unite)
    join ingredient ing on ing.nom = v.nom and ing.categorie = v.categorie and ing.fond_de_placard = v.fond;
  insert into recette (nom, temps_preparation, vegetarien, accompagnement, saisons, etapes, user_id) values ('Croque-madame', 'rapide', false, null, null, array['Préparer les croque-monsieur (pain, jambon, fromage).', 'Faire dorer à la poêle.', 'Faire cuire les œufs au plat à part.', 'Déposer un œuf sur chaque croque avant de servir.'], null) returning id into rid;
  insert into recette_ingredient (recette_id, ingredient_id, quantite, unite)
    select rid, ing.id, v.quantite, v.unite from (values
    ('pain de mie', 'boulangerie', true, 4, 'piece'),
    ('jambon', 'viandes-poissons', false, 4, 'piece'),
    ('fromage râpé', 'produits-frais', false, 150, 'g'),
    ('œufs', 'produits-frais', false, 2, 'piece'),
    ('beurre', 'produits-frais', true, 30, 'g')
    ) as v(nom, categorie, fond, quantite, unite)
    join ingredient ing on ing.nom = v.nom and ing.categorie = v.categorie and ing.fond_de_placard = v.fond;
  insert into recette (nom, temps_preparation, vegetarien, accompagnement, saisons, etapes, user_id) values ('Salade César au poulet', 'rapide', false, 'legumes', null, array['Griller les blancs de poulet et les émincer.', 'Laver et ciseler la salade.', 'Mélanger salade, croûtons, parmesan et poulet.', 'Napper de sauce César.'], null) returning id into rid;
  insert into recette_ingredient (recette_id, ingredient_id, quantite, unite)
    select rid, ing.id, v.quantite, v.unite from (values
    ('laitue romaine', 'legumes-fruits', false, 1, 'piece'),
    ('blanc de poulet', 'viandes-poissons', false, 2, 'piece'),
    ('parmesan', 'produits-frais', false, 50, 'g'),
    ('croûtons', 'boulangerie', true, 80, 'g'),
    ('sauce César', 'epicerie', false, 100, 'ml')
    ) as v(nom, categorie, fond, quantite, unite)
    join ingredient ing on ing.nom = v.nom and ing.categorie = v.categorie and ing.fond_de_placard = v.fond;
  insert into recette (nom, temps_preparation, vegetarien, accompagnement, saisons, etapes, user_id) values ('Salade de tomates mozzarella', 'rapide', true, 'legumes', array['ete'], array['Trancher les tomates et la mozzarella.', 'Alterner sur le plat de service.', 'Ajouter le basilic ciselé.', 'Arroser d''huile d''olive, saler, poivrer.'], null) returning id into rid;
  insert into recette_ingredient (recette_id, ingredient_id, quantite, unite)
    select rid, ing.id, v.quantite, v.unite from (values
    ('tomates', 'legumes-fruits', false, 4, 'piece'),
    ('mozzarella', 'produits-frais', false, 2, 'piece'),
    ('basilic', 'legumes-fruits', false, 1, 'piece'),
    ('huile d''olive', 'epicerie', true, 3, 'cas')
    ) as v(nom, categorie, fond, quantite, unite)
    join ingredient ing on ing.nom = v.nom and ing.categorie = v.categorie and ing.fond_de_placard = v.fond;
  insert into recette (nom, temps_preparation, vegetarien, accompagnement, saisons, etapes, user_id) values ('Wrap poulet crudités', 'rapide', false, 'legumes', null, array['Griller et émincer le poulet.', 'Garnir les tortillas de salade, tomates et poulet.', 'Ajouter la sauce.', 'Rouler les wraps et servir.'], null) returning id into rid;
  insert into recette_ingredient (recette_id, ingredient_id, quantite, unite)
    select rid, ing.id, v.quantite, v.unite from (values
    ('tortillas de blé', 'boulangerie', true, 4, 'piece'),
    ('blanc de poulet', 'viandes-poissons', false, 2, 'piece'),
    ('salade verte', 'legumes-fruits', false, 1, 'piece'),
    ('tomates', 'legumes-fruits', false, 2, 'piece'),
    ('sauce fromage blanc', 'produits-frais', false, 100, 'g')
    ) as v(nom, categorie, fond, quantite, unite)
    join ingredient ing on ing.nom = v.nom and ing.categorie = v.categorie and ing.fond_de_placard = v.fond;
  insert into recette (nom, temps_preparation, vegetarien, accompagnement, saisons, etapes, user_id) values ('Quiche lorraine', 'rapide', false, null, null, array['Étaler la pâte dans un moule.', 'Répartir les lardons.', 'Battre œufs, crème et fromage, verser sur le moule.', 'Cuire au four 30 min à 180°C.'], null) returning id into rid;
  insert into recette_ingredient (recette_id, ingredient_id, quantite, unite)
    select rid, ing.id, v.quantite, v.unite from (values
    ('pâte brisée', 'boulangerie', true, 1, 'piece'),
    ('lardons', 'viandes-poissons', false, 200, 'g'),
    ('œufs', 'produits-frais', false, 3, 'piece'),
    ('crème fraîche', 'produits-frais', false, 20, 'cl'),
    ('fromage râpé', 'produits-frais', false, 50, 'g')
    ) as v(nom, categorie, fond, quantite, unite)
    join ingredient ing on ing.nom = v.nom and ing.categorie = v.categorie and ing.fond_de_placard = v.fond;
  insert into recette (nom, temps_preparation, vegetarien, accompagnement, saisons, etapes, user_id) values ('Quiche aux poireaux', 'rapide', true, null, array['automne'], array['Faire fondre les poireaux émincés à la poêle.', 'Étaler la pâte dans un moule.', 'Répartir les poireaux, verser l''appareil œufs-crème-fromage.', 'Cuire au four 30 min à 180°C.'], null) returning id into rid;
  insert into recette_ingredient (recette_id, ingredient_id, quantite, unite)
    select rid, ing.id, v.quantite, v.unite from (values
    ('pâte brisée', 'boulangerie', true, 1, 'piece'),
    ('poireaux', 'legumes-fruits', false, 3, 'piece'),
    ('œufs', 'produits-frais', false, 3, 'piece'),
    ('crème fraîche', 'produits-frais', false, 20, 'cl'),
    ('fromage râpé', 'produits-frais', false, 50, 'g')
    ) as v(nom, categorie, fond, quantite, unite)
    join ingredient ing on ing.nom = v.nom and ing.categorie = v.categorie and ing.fond_de_placard = v.fond;
  insert into recette (nom, temps_preparation, vegetarien, accompagnement, saisons, etapes, user_id) values ('Steak haché frites', 'rapide', false, 'feculents', null, array['Couper les pommes de terre en frites et les cuire.', 'Cuire les steaks hachés à la poêle selon la cuisson désirée.', 'Saler.', 'Servir ensemble.'], null) returning id into rid;
  insert into recette_ingredient (recette_id, ingredient_id, quantite, unite)
    select rid, ing.id, v.quantite, v.unite from (values
    ('steak haché', 'viandes-poissons', false, 2, 'piece'),
    ('pommes de terre', 'legumes-fruits', true, 600, 'g'),
    ('huile de tournesol', 'epicerie', true, 500, 'ml'),
    ('sel', 'epicerie', true, 1, 'cac')
    ) as v(nom, categorie, fond, quantite, unite)
    join ingredient ing on ing.nom = v.nom and ing.categorie = v.categorie and ing.fond_de_placard = v.fond;
  insert into recette (nom, temps_preparation, vegetarien, accompagnement, saisons, etapes, user_id) values ('Steak haché, poêlée de légumes', 'rapide', false, 'legumes', null, array['Couper les légumes en dés.', 'Les faire sauter à la poêle à l''huile d''olive.', 'Cuire les steaks hachés à part.', 'Servir ensemble.'], null) returning id into rid;
  insert into recette_ingredient (recette_id, ingredient_id, quantite, unite)
    select rid, ing.id, v.quantite, v.unite from (values
    ('steak haché', 'viandes-poissons', false, 2, 'piece'),
    ('courgettes', 'legumes-fruits', false, 2, 'piece'),
    ('poivrons', 'legumes-fruits', false, 2, 'piece'),
    ('huile d''olive', 'epicerie', true, 2, 'cas')
    ) as v(nom, categorie, fond, quantite, unite)
    join ingredient ing on ing.nom = v.nom and ing.categorie = v.categorie and ing.fond_de_placard = v.fond;
  insert into recette (nom, temps_preparation, vegetarien, accompagnement, saisons, etapes, user_id) values ('Poêlée de légumes au tofu', 'rapide', true, 'legumes', array['ete'], array['Couper le tofu en cubes et le faire dorer à la poêle.', 'Faire sauter les légumes coupés en dés.', 'Réunir tofu et légumes, ajouter la sauce soja.', 'Servir chaud.'], null) returning id into rid;
  insert into recette_ingredient (recette_id, ingredient_id, quantite, unite)
    select rid, ing.id, v.quantite, v.unite from (values
    ('tofu ferme', 'produits-frais', false, 300, 'g'),
    ('courgettes', 'legumes-fruits', false, 2, 'piece'),
    ('poivrons', 'legumes-fruits', false, 2, 'piece'),
    ('sauce soja', 'epicerie', true, 2, 'cas')
    ) as v(nom, categorie, fond, quantite, unite)
    join ingredient ing on ing.nom = v.nom and ing.categorie = v.categorie and ing.fond_de_placard = v.fond;
  insert into recette (nom, temps_preparation, vegetarien, accompagnement, saisons, etapes, user_id) values ('Pâtes bolognaise', 'rapide', false, 'feculents', null, array['Faire revenir l''oignon émincé puis la viande hachée.', 'Ajouter la sauce tomate, laisser mijoter 15 min.', 'Cuire les pâtes.', 'Servir la sauce sur les pâtes avec le parmesan.'], null) returning id into rid;
  insert into recette_ingredient (recette_id, ingredient_id, quantite, unite)
    select rid, ing.id, v.quantite, v.unite from (values
    ('spaghetti', 'epicerie', true, 200, 'g'),
    ('bœuf haché', 'viandes-poissons', false, 300, 'g'),
    ('sauce tomate', 'epicerie', true, 400, 'g'),
    ('oignon', 'legumes-fruits', true, 1, 'piece'),
    ('parmesan', 'produits-frais', false, 30, 'g')
    ) as v(nom, categorie, fond, quantite, unite)
    join ingredient ing on ing.nom = v.nom and ing.categorie = v.categorie and ing.fond_de_placard = v.fond;
  insert into recette (nom, temps_preparation, vegetarien, accompagnement, saisons, etapes, user_id) values ('Pâtes à la tomate et basilic', 'rapide', true, 'feculents', array['ete'], array['Faire revenir l''ail dans l''huile d''olive.', 'Ajouter les tomates concassées, laisser réduire.', 'Cuire les pâtes.', 'Mélanger avec la sauce et le basilic frais.'], null) returning id into rid;
  insert into recette_ingredient (recette_id, ingredient_id, quantite, unite)
    select rid, ing.id, v.quantite, v.unite from (values
    ('penne', 'epicerie', true, 200, 'g'),
    ('tomates', 'legumes-fruits', false, 4, 'piece'),
    ('basilic', 'legumes-fruits', false, 1, 'piece'),
    ('ail', 'legumes-fruits', true, 1, 'piece'),
    ('huile d''olive', 'epicerie', true, 2, 'cas')
    ) as v(nom, categorie, fond, quantite, unite)
    join ingredient ing on ing.nom = v.nom and ing.categorie = v.categorie and ing.fond_de_placard = v.fond;
  insert into recette (nom, temps_preparation, vegetarien, accompagnement, saisons, etapes, user_id) values ('Salade de pâtes au thon', 'rapide', false, 'feculents', array['ete'], array['Cuire les pâtes et les refroidir.', 'Émietter le thon.', 'Mélanger pâtes, thon, tomates cerises et maïs.', 'Assaisonner de vinaigrette.'], null) returning id into rid;
  insert into recette_ingredient (recette_id, ingredient_id, quantite, unite)
    select rid, ing.id, v.quantite, v.unite from (values
    ('coquillettes', 'epicerie', true, 200, 'g'),
    ('thon au naturel', 'viandes-poissons', true, 2, 'boite'),
    ('tomates cerises', 'legumes-fruits', false, 200, 'g'),
    ('maïs', 'epicerie', true, 1, 'boite'),
    ('vinaigrette', 'epicerie', true, 3, 'cas')
    ) as v(nom, categorie, fond, quantite, unite)
    join ingredient ing on ing.nom = v.nom and ing.categorie = v.categorie and ing.fond_de_placard = v.fond;
  insert into recette (nom, temps_preparation, vegetarien, accompagnement, saisons, etapes, user_id) values ('Croque hawaïen', 'rapide', false, null, null, array['Garnir le pain de jambon, ananas et fromage.', 'Refermer les croques.', 'Faire dorer à la poêle ou au four.', 'Servir chaud.'], null) returning id into rid;
  insert into recette_ingredient (recette_id, ingredient_id, quantite, unite)
    select rid, ing.id, v.quantite, v.unite from (values
    ('pain de mie', 'boulangerie', true, 4, 'piece'),
    ('jambon', 'viandes-poissons', false, 4, 'piece'),
    ('ananas en tranches', 'epicerie', false, 4, 'piece'),
    ('fromage râpé', 'produits-frais', false, 150, 'g')
    ) as v(nom, categorie, fond, quantite, unite)
    join ingredient ing on ing.nom = v.nom and ing.categorie = v.categorie and ing.fond_de_placard = v.fond;
  insert into recette (nom, temps_preparation, vegetarien, accompagnement, saisons, etapes, user_id) values ('Sandwich club', 'rapide', false, null, null, array['Griller le poulet et le bacon.', 'Toaster le pain.', 'Monter le sandwich en étages avec salade, tomate, poulet et bacon.', 'Napper de mayonnaise et refermer.'], null) returning id into rid;
  insert into recette_ingredient (recette_id, ingredient_id, quantite, unite)
    select rid, ing.id, v.quantite, v.unite from (values
    ('pain de mie', 'boulangerie', true, 6, 'piece'),
    ('blanc de poulet', 'viandes-poissons', false, 1, 'piece'),
    ('bacon', 'viandes-poissons', false, 4, 'piece'),
    ('tomates', 'legumes-fruits', false, 1, 'piece'),
    ('salade verte', 'legumes-fruits', false, 4, 'piece'),
    ('mayonnaise', 'epicerie', true, 2, 'cas')
    ) as v(nom, categorie, fond, quantite, unite)
    join ingredient ing on ing.nom = v.nom and ing.categorie = v.categorie and ing.fond_de_placard = v.fond;
  insert into recette (nom, temps_preparation, vegetarien, accompagnement, saisons, etapes, user_id) values ('Poisson pané, petits pois', 'rapide', false, 'legumes', null, array['Cuire les filets panés au four ou à la poêle selon l''emballage.', 'Cuire les petits pois à l''eau.', 'Ajouter une noisette de beurre aux petits pois.', 'Servir ensemble.'], null) returning id into rid;
  insert into recette_ingredient (recette_id, ingredient_id, quantite, unite)
    select rid, ing.id, v.quantite, v.unite from (values
    ('filets de poisson panés', 'surgeles', true, 4, 'piece'),
    ('petits pois', 'surgeles', true, 400, 'g'),
    ('beurre', 'produits-frais', true, 20, 'g')
    ) as v(nom, categorie, fond, quantite, unite)
    join ingredient ing on ing.nom = v.nom and ing.categorie = v.categorie and ing.fond_de_placard = v.fond;
  insert into recette (nom, temps_preparation, vegetarien, accompagnement, saisons, etapes, user_id) values ('Filet de poisson poêlé, riz', 'rapide', false, 'feculents', null, array['Cuire le riz.', 'Poêler les filets de poisson au beurre.', 'Arroser de jus de citron.', 'Servir avec le riz.'], null) returning id into rid;
  insert into recette_ingredient (recette_id, ingredient_id, quantite, unite)
    select rid, ing.id, v.quantite, v.unite from (values
    ('filet de cabillaud', 'viandes-poissons', false, 2, 'piece'),
    ('riz basmati', 'epicerie', true, 150, 'g'),
    ('citron', 'legumes-fruits', false, 1, 'piece'),
    ('beurre', 'produits-frais', true, 20, 'g')
    ) as v(nom, categorie, fond, quantite, unite)
    join ingredient ing on ing.nom = v.nom and ing.categorie = v.categorie and ing.fond_de_placard = v.fond;
  insert into recette (nom, temps_preparation, vegetarien, accompagnement, saisons, etapes, user_id) values ('Sauté de porc au curry rapide', 'rapide', false, 'feculents', null, array['Couper le porc en lamelles et le faire dorer.', 'Ajouter le curry en poudre puis le lait de coco.', 'Laisser mijoter 10 min.', 'Servir avec le riz.'], null) returning id into rid;
  insert into recette_ingredient (recette_id, ingredient_id, quantite, unite)
    select rid, ing.id, v.quantite, v.unite from (values
    ('filet de porc', 'viandes-poissons', false, 300, 'g'),
    ('lait de coco', 'epicerie', true, 200, 'ml'),
    ('curry en poudre', 'epicerie', true, 1, 'cas'),
    ('riz basmati', 'epicerie', true, 150, 'g')
    ) as v(nom, categorie, fond, quantite, unite)
    join ingredient ing on ing.nom = v.nom and ing.categorie = v.categorie and ing.fond_de_placard = v.fond;
  insert into recette (nom, temps_preparation, vegetarien, accompagnement, saisons, etapes, user_id) values ('Escalope de dinde à la crème', 'rapide', false, 'feculents', null, array['Cuire les tagliatelles.', 'Poêler les escalopes de dinde.', 'Ajouter les champignons puis la crème, laisser réduire.', 'Napper les escalopes de la sauce.'], null) returning id into rid;
  insert into recette_ingredient (recette_id, ingredient_id, quantite, unite)
    select rid, ing.id, v.quantite, v.unite from (values
    ('escalope de dinde', 'viandes-poissons', false, 2, 'piece'),
    ('crème fraîche', 'produits-frais', false, 20, 'cl'),
    ('champignons de Paris', 'legumes-fruits', false, 150, 'g'),
    ('tagliatelles', 'epicerie', true, 200, 'g')
    ) as v(nom, categorie, fond, quantite, unite)
    join ingredient ing on ing.nom = v.nom and ing.categorie = v.categorie and ing.fond_de_placard = v.fond;
  insert into recette (nom, temps_preparation, vegetarien, accompagnement, saisons, etapes, user_id) values ('Escalope de poulet panée, purée', 'rapide', false, 'feculents', null, array['Cuire les pommes de terre à l''eau.', 'Écraser en purée avec lait et beurre.', 'Cuire les escalopes panées à la poêle.', 'Servir ensemble.'], null) returning id into rid;
  insert into recette_ingredient (recette_id, ingredient_id, quantite, unite)
    select rid, ing.id, v.quantite, v.unite from (values
    ('escalope de poulet panée', 'viandes-poissons', false, 2, 'piece'),
    ('pommes de terre', 'legumes-fruits', true, 500, 'g'),
    ('lait', 'produits-frais', false, 100, 'ml'),
    ('beurre', 'produits-frais', true, 30, 'g')
    ) as v(nom, categorie, fond, quantite, unite)
    join ingredient ing on ing.nom = v.nom and ing.categorie = v.categorie and ing.fond_de_placard = v.fond;
  insert into recette (nom, temps_preparation, vegetarien, accompagnement, saisons, etapes, user_id) values ('Salade de lentilles au chèvre chaud', 'rapide', true, 'legumes', array['automne'], array['Passer les tranches de pain garnies de chèvre au four.', 'Assaisonner les lentilles de vinaigrette.', 'Dresser les lentilles en salade.', 'Ajouter les toasts de chèvre chaud.'], null) returning id into rid;
  insert into recette_ingredient (recette_id, ingredient_id, quantite, unite)
    select rid, ing.id, v.quantite, v.unite from (values
    ('lentilles vertes cuites', 'epicerie', true, 300, 'g'),
    ('fromage de chèvre', 'produits-frais', false, 2, 'piece'),
    ('pain de campagne', 'boulangerie', true, 2, 'piece'),
    ('vinaigrette', 'epicerie', true, 2, 'cas')
    ) as v(nom, categorie, fond, quantite, unite)
    join ingredient ing on ing.nom = v.nom and ing.categorie = v.categorie and ing.fond_de_placard = v.fond;
  insert into recette (nom, temps_preparation, vegetarien, accompagnement, saisons, etapes, user_id) values ('Taboulé au poulet', 'rapide', false, 'legumes', array['ete'], array['Faire gonfler la semoule à l''eau chaude.', 'Griller et couper le poulet en dés.', 'Couper les tomates en dés, ciseler la menthe.', 'Mélanger le tout avec le jus de citron.'], null) returning id into rid;
  insert into recette_ingredient (recette_id, ingredient_id, quantite, unite)
    select rid, ing.id, v.quantite, v.unite from (values
    ('semoule', 'epicerie', true, 200, 'g'),
    ('blanc de poulet', 'viandes-poissons', false, 2, 'piece'),
    ('tomates', 'legumes-fruits', false, 2, 'piece'),
    ('menthe fraîche', 'legumes-fruits', false, 1, 'piece'),
    ('citron', 'legumes-fruits', false, 1, 'piece')
    ) as v(nom, categorie, fond, quantite, unite)
    join ingredient ing on ing.nom = v.nom and ing.categorie = v.categorie and ing.fond_de_placard = v.fond;
  insert into recette (nom, temps_preparation, vegetarien, accompagnement, saisons, etapes, user_id) values ('Taboulé végétarien', 'rapide', true, 'legumes', array['ete'], array['Faire gonfler la semoule à l''eau chaude.', 'Couper tomates et concombre en dés.', 'Ciseler la menthe.', 'Mélanger le tout avec le jus de citron.'], null) returning id into rid;
  insert into recette_ingredient (recette_id, ingredient_id, quantite, unite)
    select rid, ing.id, v.quantite, v.unite from (values
    ('semoule', 'epicerie', true, 200, 'g'),
    ('tomates', 'legumes-fruits', false, 2, 'piece'),
    ('concombre', 'legumes-fruits', false, 1, 'piece'),
    ('menthe fraîche', 'legumes-fruits', false, 1, 'piece'),
    ('citron', 'legumes-fruits', false, 1, 'piece')
    ) as v(nom, categorie, fond, quantite, unite)
    join ingredient ing on ing.nom = v.nom and ing.categorie = v.categorie and ing.fond_de_placard = v.fond;
  insert into recette (nom, temps_preparation, vegetarien, accompagnement, saisons, etapes, user_id) values ('Gratin de coquillettes au jambon', 'rapide', false, 'feculents', null, array['Cuire les coquillettes.', 'Mélanger avec le jambon coupé et la crème.', 'Verser dans un plat, couvrir de fromage.', 'Gratiner au four.'], null) returning id into rid;
  insert into recette_ingredient (recette_id, ingredient_id, quantite, unite)
    select rid, ing.id, v.quantite, v.unite from (values
    ('coquillettes', 'epicerie', true, 250, 'g'),
    ('jambon', 'viandes-poissons', false, 150, 'g'),
    ('fromage râpé', 'produits-frais', false, 100, 'g'),
    ('crème fraîche', 'produits-frais', false, 10, 'cl')
    ) as v(nom, categorie, fond, quantite, unite)
    join ingredient ing on ing.nom = v.nom and ing.categorie = v.categorie and ing.fond_de_placard = v.fond;
  insert into recette (nom, temps_preparation, vegetarien, accompagnement, saisons, etapes, user_id) values ('Riz sauté aux légumes et œuf', 'rapide', true, 'legumes', null, array['Cuire le riz et le laisser refroidir.', 'Faire sauter les légumes en dés.', 'Ajouter le riz et l''œuf battu, mélanger en cuisant.', 'Assaisonner de sauce soja.'], null) returning id into rid;
  insert into recette_ingredient (recette_id, ingredient_id, quantite, unite)
    select rid, ing.id, v.quantite, v.unite from (values
    ('riz basmati', 'epicerie', true, 200, 'g'),
    ('œufs', 'produits-frais', false, 2, 'piece'),
    ('petits pois', 'surgeles', true, 100, 'g'),
    ('carottes', 'legumes-fruits', true, 2, 'piece'),
    ('sauce soja', 'epicerie', true, 2, 'cas')
    ) as v(nom, categorie, fond, quantite, unite)
    join ingredient ing on ing.nom = v.nom and ing.categorie = v.categorie and ing.fond_de_placard = v.fond;
  insert into recette (nom, temps_preparation, vegetarien, accompagnement, saisons, etapes, user_id) values ('Poêlée de crevettes à l''ail, riz', 'rapide', false, 'feculents', null, array['Cuire le riz.', 'Faire revenir l''ail émincé dans l''huile.', 'Ajouter les crevettes, cuire 3-4 min.', 'Parsemer de persil et servir avec le riz.'], null) returning id into rid;
  insert into recette_ingredient (recette_id, ingredient_id, quantite, unite)
    select rid, ing.id, v.quantite, v.unite from (values
    ('crevettes décortiquées', 'surgeles', true, 300, 'g'),
    ('ail', 'legumes-fruits', true, 2, 'piece'),
    ('persil', 'legumes-fruits', false, 1, 'piece'),
    ('riz basmati', 'epicerie', true, 150, 'g')
    ) as v(nom, categorie, fond, quantite, unite)
    join ingredient ing on ing.nom = v.nom and ing.categorie = v.categorie and ing.fond_de_placard = v.fond;
  insert into recette (nom, temps_preparation, vegetarien, accompagnement, saisons, etapes, user_id) values ('Galettes de pois chiches', 'rapide', true, 'legumes', null, array['Mixer les pois chiches avec l''oignon et le cumin.', 'Ajouter la farine pour lier.', 'Former des galettes.', 'Cuire à la poêle des deux côtés.'], null) returning id into rid;
  insert into recette_ingredient (recette_id, ingredient_id, quantite, unite)
    select rid, ing.id, v.quantite, v.unite from (values
    ('pois chiches cuits', 'epicerie', true, 400, 'g'),
    ('oignon', 'legumes-fruits', true, 1, 'piece'),
    ('cumin', 'epicerie', true, 1, 'cac'),
    ('farine', 'epicerie', true, 2, 'cas')
    ) as v(nom, categorie, fond, quantite, unite)
    join ingredient ing on ing.nom = v.nom and ing.categorie = v.categorie and ing.fond_de_placard = v.fond;
  insert into recette (nom, temps_preparation, vegetarien, accompagnement, saisons, etapes, user_id) values ('Burger maison', 'rapide', false, 'feculents', null, array['Cuire les steaks hachés à la poêle.', 'Toaster les pains.', 'Garnir de fromage, salade et tomate.', 'Assembler les burgers.'], null) returning id into rid;
  insert into recette_ingredient (recette_id, ingredient_id, quantite, unite)
    select rid, ing.id, v.quantite, v.unite from (values
    ('pain à burger', 'boulangerie', true, 2, 'piece'),
    ('steak haché', 'viandes-poissons', false, 2, 'piece'),
    ('cheddar', 'produits-frais', false, 2, 'piece'),
    ('salade verte', 'legumes-fruits', false, 2, 'piece'),
    ('tomates', 'legumes-fruits', false, 1, 'piece')
    ) as v(nom, categorie, fond, quantite, unite)
    join ingredient ing on ing.nom = v.nom and ing.categorie = v.categorie and ing.fond_de_placard = v.fond;
  insert into recette (nom, temps_preparation, vegetarien, accompagnement, saisons, etapes, user_id) values ('Burger végétarien', 'rapide', true, 'feculents', null, array['Cuire les galettes végétales selon l''emballage.', 'Toaster les pains.', 'Garnir de fromage, salade et tomate.', 'Assembler les burgers.'], null) returning id into rid;
  insert into recette_ingredient (recette_id, ingredient_id, quantite, unite)
    select rid, ing.id, v.quantite, v.unite from (values
    ('pain à burger', 'boulangerie', true, 2, 'piece'),
    ('galette végétale', 'surgeles', false, 2, 'piece'),
    ('cheddar', 'produits-frais', false, 2, 'piece'),
    ('salade verte', 'legumes-fruits', false, 2, 'piece'),
    ('tomates', 'legumes-fruits', false, 1, 'piece')
    ) as v(nom, categorie, fond, quantite, unite)
    join ingredient ing on ing.nom = v.nom and ing.categorie = v.categorie and ing.fond_de_placard = v.fond;
  insert into recette (nom, temps_preparation, vegetarien, accompagnement, saisons, etapes, user_id) values ('Salade grecque', 'rapide', true, 'legumes', array['ete'], array['Couper tomates et concombre en gros dés.', 'Ajouter la feta en cubes et les olives.', 'Arroser d''huile d''olive.', 'Servir frais.'], null) returning id into rid;
  insert into recette_ingredient (recette_id, ingredient_id, quantite, unite)
    select rid, ing.id, v.quantite, v.unite from (values
    ('tomates', 'legumes-fruits', false, 3, 'piece'),
    ('concombre', 'legumes-fruits', false, 1, 'piece'),
    ('feta', 'produits-frais', false, 200, 'g'),
    ('olives noires', 'epicerie', false, 100, 'g'),
    ('huile d''olive', 'epicerie', true, 3, 'cas')
    ) as v(nom, categorie, fond, quantite, unite)
    join ingredient ing on ing.nom = v.nom and ing.categorie = v.categorie and ing.fond_de_placard = v.fond;
  insert into recette (nom, temps_preparation, vegetarien, accompagnement, saisons, etapes, user_id) values ('Gaspacho et toasts', 'rapide', true, null, array['ete'], array['Mixer tomates, concombre, poivron et huile d''olive.', 'Passer au chinois si désiré.', 'Réfrigérer au moins 1h.', 'Servir bien frais avec les toasts.'], null) returning id into rid;
  insert into recette_ingredient (recette_id, ingredient_id, quantite, unite)
    select rid, ing.id, v.quantite, v.unite from (values
    ('tomates', 'legumes-fruits', false, 6, 'piece'),
    ('concombre', 'legumes-fruits', false, 1, 'piece'),
    ('poivron rouge', 'legumes-fruits', false, 1, 'piece'),
    ('pain de campagne', 'boulangerie', true, 4, 'piece'),
    ('huile d''olive', 'epicerie', true, 2, 'cas')
    ) as v(nom, categorie, fond, quantite, unite)
    join ingredient ing on ing.nom = v.nom and ing.categorie = v.categorie and ing.fond_de_placard = v.fond;
  insert into recette (nom, temps_preparation, vegetarien, accompagnement, saisons, etapes, user_id) values ('Velouté de légumes de saison', 'rapide', true, null, array['hiver'], array['Éplucher et couper les légumes.', 'Cuire dans le bouillon 20 min.', 'Mixer avec la crème et le beurre.', 'Servir chaud.'], null) returning id into rid;
  insert into recette_ingredient (recette_id, ingredient_id, quantite, unite)
    select rid, ing.id, v.quantite, v.unite from (values
    ('légumes de saison', 'legumes-fruits', false, 600, 'g'),
    ('bouillon de légumes', 'epicerie', true, 1, 'piece'),
    ('crème fraîche', 'produits-frais', false, 10, 'cl'),
    ('beurre', 'produits-frais', true, 20, 'g')
    ) as v(nom, categorie, fond, quantite, unite)
    join ingredient ing on ing.nom = v.nom and ing.categorie = v.categorie and ing.fond_de_placard = v.fond;
  insert into recette (nom, temps_preparation, vegetarien, accompagnement, saisons, etapes, user_id) values ('Poêlée de gambas, tagliatelles', 'rapide', false, 'feculents', null, array['Cuire les tagliatelles.', 'Faire revenir l''ail dans l''huile d''olive.', 'Ajouter les gambas, cuire quelques minutes.', 'Mélanger aux pâtes et parsemer de persil.'], null) returning id into rid;
  insert into recette_ingredient (recette_id, ingredient_id, quantite, unite)
    select rid, ing.id, v.quantite, v.unite from (values
    ('gambas', 'surgeles', true, 300, 'g'),
    ('tagliatelles', 'epicerie', true, 200, 'g'),
    ('ail', 'legumes-fruits', true, 2, 'piece'),
    ('persil', 'legumes-fruits', false, 1, 'piece'),
    ('huile d''olive', 'epicerie', true, 2, 'cas')
    ) as v(nom, categorie, fond, quantite, unite)
    join ingredient ing on ing.nom = v.nom and ing.categorie = v.categorie and ing.fond_de_placard = v.fond;
  insert into recette (nom, temps_preparation, vegetarien, accompagnement, saisons, etapes, user_id) values ('Œufs au plat, ratatouille rapide', 'rapide', true, 'legumes', array['ete'], array['Couper les légumes en dés et les faire revenir à l''huile d''olive.', 'Laisser mijoter 10 min.', 'Cuire les œufs au plat à part.', 'Servir les œufs sur la ratatouille.'], null) returning id into rid;
  insert into recette_ingredient (recette_id, ingredient_id, quantite, unite)
    select rid, ing.id, v.quantite, v.unite from (values
    ('œufs', 'produits-frais', false, 4, 'piece'),
    ('courgettes', 'legumes-fruits', false, 2, 'piece'),
    ('aubergine', 'legumes-fruits', false, 1, 'piece'),
    ('poivrons', 'legumes-fruits', false, 1, 'piece'),
    ('tomates', 'legumes-fruits', false, 2, 'piece')
    ) as v(nom, categorie, fond, quantite, unite)
    join ingredient ing on ing.nom = v.nom and ing.categorie = v.categorie and ing.fond_de_placard = v.fond;
  insert into recette (nom, temps_preparation, vegetarien, accompagnement, saisons, etapes, user_id) values ('Sauté de bœuf poivrons, riz', 'rapide', false, 'feculents', null, array['Cuire le riz.', 'Faire sauter le bœuf à feu vif.', 'Ajouter les poivrons émincés et la sauce soja.', 'Servir avec le riz.'], null) returning id into rid;
  insert into recette_ingredient (recette_id, ingredient_id, quantite, unite)
    select rid, ing.id, v.quantite, v.unite from (values
    ('bœuf en lanières', 'viandes-poissons', false, 300, 'g'),
    ('poivrons', 'legumes-fruits', false, 2, 'piece'),
    ('sauce soja', 'epicerie', true, 2, 'cas'),
    ('riz basmati', 'epicerie', true, 150, 'g')
    ) as v(nom, categorie, fond, quantite, unite)
    join ingredient ing on ing.nom = v.nom and ing.categorie = v.categorie and ing.fond_de_placard = v.fond;
  insert into recette (nom, temps_preparation, vegetarien, accompagnement, saisons, etapes, user_id) values ('Poêlée de saumon, haricots verts', 'rapide', false, 'legumes', null, array['Cuire les haricots verts à l''eau.', 'Poêler les pavés de saumon.', 'Ajouter une noisette de beurre et un filet de citron.', 'Servir ensemble.'], null) returning id into rid;
  insert into recette_ingredient (recette_id, ingredient_id, quantite, unite)
    select rid, ing.id, v.quantite, v.unite from (values
    ('pavé de saumon', 'viandes-poissons', false, 2, 'piece'),
    ('haricots verts', 'surgeles', true, 400, 'g'),
    ('beurre', 'produits-frais', true, 20, 'g'),
    ('citron', 'legumes-fruits', false, 1, 'piece')
    ) as v(nom, categorie, fond, quantite, unite)
    join ingredient ing on ing.nom = v.nom and ing.categorie = v.categorie and ing.fond_de_placard = v.fond;
  insert into recette (nom, temps_preparation, vegetarien, accompagnement, saisons, etapes, user_id) values ('Salade de quinoa aux légumes grillés', 'rapide', true, 'legumes', array['ete'], array['Cuire le quinoa.', 'Griller les légumes coupés en morceaux.', 'Mélanger quinoa et légumes.', 'Assaisonner d''huile d''olive.'], null) returning id into rid;
  insert into recette_ingredient (recette_id, ingredient_id, quantite, unite)
    select rid, ing.id, v.quantite, v.unite from (values
    ('quinoa', 'epicerie', true, 200, 'g'),
    ('courgettes', 'legumes-fruits', false, 2, 'piece'),
    ('poivrons', 'legumes-fruits', false, 1, 'piece'),
    ('huile d''olive', 'epicerie', true, 2, 'cas')
    ) as v(nom, categorie, fond, quantite, unite)
    join ingredient ing on ing.nom = v.nom and ing.categorie = v.categorie and ing.fond_de_placard = v.fond;
  insert into recette (nom, temps_preparation, vegetarien, accompagnement, saisons, etapes, user_id) values ('Croque au chèvre et miel', 'rapide', true, null, array['automne'], array['Déposer le chèvre sur les tranches de pain.', 'Arroser d''un filet de miel et parsemer de noix.', 'Passer au four quelques minutes.', 'Servir tiède.'], null) returning id into rid;
  insert into recette_ingredient (recette_id, ingredient_id, quantite, unite)
    select rid, ing.id, v.quantite, v.unite from (values
    ('pain de campagne', 'boulangerie', true, 4, 'piece'),
    ('fromage de chèvre', 'produits-frais', false, 2, 'piece'),
    ('miel', 'epicerie', true, 2, 'cas'),
    ('noix', 'epicerie', true, 30, 'g')
    ) as v(nom, categorie, fond, quantite, unite)
    join ingredient ing on ing.nom = v.nom and ing.categorie = v.categorie and ing.fond_de_placard = v.fond;
  insert into recette (nom, temps_preparation, vegetarien, accompagnement, saisons, etapes, user_id) values ('Pâtes aux courgettes et parmesan', 'rapide', true, 'feculents', array['ete'], array['Cuire les pâtes.', 'Faire revenir les courgettes en rubans à l''huile d''olive.', 'Mélanger pâtes et courgettes.', 'Parsemer de parmesan.'], null) returning id into rid;
  insert into recette_ingredient (recette_id, ingredient_id, quantite, unite)
    select rid, ing.id, v.quantite, v.unite from (values
    ('penne', 'epicerie', true, 200, 'g'),
    ('courgettes', 'legumes-fruits', false, 3, 'piece'),
    ('parmesan', 'produits-frais', false, 50, 'g'),
    ('huile d''olive', 'epicerie', true, 2, 'cas')
    ) as v(nom, categorie, fond, quantite, unite)
    join ingredient ing on ing.nom = v.nom and ing.categorie = v.categorie and ing.fond_de_placard = v.fond;
  insert into recette (nom, temps_preparation, vegetarien, accompagnement, saisons, etapes, user_id) values ('Omelette au jambon', 'rapide', false, null, null, array['Battre les œufs.', 'Couper le jambon en dés.', 'Cuire l''omelette avec le jambon.', 'Servir chaud.'], null) returning id into rid;
  insert into recette_ingredient (recette_id, ingredient_id, quantite, unite)
    select rid, ing.id, v.quantite, v.unite from (values
    ('œufs', 'produits-frais', false, 6, 'piece'),
    ('jambon', 'viandes-poissons', false, 100, 'g'),
    ('beurre', 'produits-frais', true, 20, 'g')
    ) as v(nom, categorie, fond, quantite, unite)
    join ingredient ing on ing.nom = v.nom and ing.categorie = v.categorie and ing.fond_de_placard = v.fond;
  insert into recette (nom, temps_preparation, vegetarien, accompagnement, saisons, etapes, user_id) values ('Poulet rôti, pommes de terre', 'normal', false, 'feculents', null, array['Préchauffer le four à 200°C.', 'Disposer le poulet et les pommes de terre dans un plat.', 'Badigeonner de beurre, ajouter le thym.', 'Cuire 1h en arrosant régulièrement.'], null) returning id into rid;
  insert into recette_ingredient (recette_id, ingredient_id, quantite, unite)
    select rid, ing.id, v.quantite, v.unite from (values
    ('poulet entier', 'viandes-poissons', false, 1, 'piece'),
    ('pommes de terre', 'legumes-fruits', true, 800, 'g'),
    ('thym', 'legumes-fruits', true, 1, 'piece'),
    ('beurre', 'produits-frais', true, 30, 'g')
    ) as v(nom, categorie, fond, quantite, unite)
    join ingredient ing on ing.nom = v.nom and ing.categorie = v.categorie and ing.fond_de_placard = v.fond;
  insert into recette (nom, temps_preparation, vegetarien, accompagnement, saisons, etapes, user_id) values ('Poulet aux champignons, riz', 'normal', false, 'feculents', array['automne'], array['Faire dorer les cuisses de poulet.', 'Ajouter les champignons émincés.', 'Verser la crème, laisser mijoter 20 min.', 'Servir avec le riz.'], null) returning id into rid;
  insert into recette_ingredient (recette_id, ingredient_id, quantite, unite)
    select rid, ing.id, v.quantite, v.unite from (values
    ('cuisses de poulet', 'viandes-poissons', false, 4, 'piece'),
    ('champignons de Paris', 'legumes-fruits', false, 300, 'g'),
    ('crème fraîche', 'produits-frais', false, 20, 'cl'),
    ('riz basmati', 'epicerie', true, 200, 'g')
    ) as v(nom, categorie, fond, quantite, unite)
    join ingredient ing on ing.nom = v.nom and ing.categorie = v.categorie and ing.fond_de_placard = v.fond;
  insert into recette (nom, temps_preparation, vegetarien, accompagnement, saisons, etapes, user_id) values ('Blanc de poulet à la crème et champignons', 'normal', false, 'feculents', array['automne'], array['Cuire les tagliatelles.', 'Poêler les blancs de poulet.', 'Ajouter les champignons et la crème, laisser mijoter.', 'Servir avec les tagliatelles.'], null) returning id into rid;
  insert into recette_ingredient (recette_id, ingredient_id, quantite, unite)
    select rid, ing.id, v.quantite, v.unite from (values
    ('blanc de poulet', 'viandes-poissons', false, 4, 'piece'),
    ('champignons de Paris', 'legumes-fruits', false, 300, 'g'),
    ('crème fraîche', 'produits-frais', false, 20, 'cl'),
    ('tagliatelles', 'epicerie', true, 200, 'g')
    ) as v(nom, categorie, fond, quantite, unite)
    join ingredient ing on ing.nom = v.nom and ing.categorie = v.categorie and ing.fond_de_placard = v.fond;
  insert into recette (nom, temps_preparation, vegetarien, accompagnement, saisons, etapes, user_id) values ('Sauté de veau aux carottes', 'normal', false, 'legumes', array['hiver'], array['Faire dorer le veau.', 'Ajouter oignon et carottes en rondelles.', 'Mouiller avec le bouillon.', 'Laisser mijoter 35 min.'], null) returning id into rid;
  insert into recette_ingredient (recette_id, ingredient_id, quantite, unite)
    select rid, ing.id, v.quantite, v.unite from (values
    ('sauté de veau', 'viandes-poissons', false, 500, 'g'),
    ('carottes', 'legumes-fruits', true, 500, 'g'),
    ('oignon', 'legumes-fruits', true, 1, 'piece'),
    ('bouillon de volaille', 'epicerie', true, 1, 'piece')
    ) as v(nom, categorie, fond, quantite, unite)
    join ingredient ing on ing.nom = v.nom and ing.categorie = v.categorie and ing.fond_de_placard = v.fond;
  insert into recette (nom, temps_preparation, vegetarien, accompagnement, saisons, etapes, user_id) values ('Papillote de saumon aux légumes', 'normal', false, 'legumes', array['ete'], array['Préchauffer le four à 180°C.', 'Disposer le saumon et les légumes sur du papier cuisson.', 'Arroser de jus de citron, refermer en papillote.', 'Cuire 20 min au four.'], null) returning id into rid;
  insert into recette_ingredient (recette_id, ingredient_id, quantite, unite)
    select rid, ing.id, v.quantite, v.unite from (values
    ('pavé de saumon', 'viandes-poissons', false, 2, 'piece'),
    ('courgettes', 'legumes-fruits', false, 1, 'piece'),
    ('tomates cerises', 'legumes-fruits', false, 150, 'g'),
    ('citron', 'legumes-fruits', false, 1, 'piece')
    ) as v(nom, categorie, fond, quantite, unite)
    join ingredient ing on ing.nom = v.nom and ing.categorie = v.categorie and ing.fond_de_placard = v.fond;
  insert into recette (nom, temps_preparation, vegetarien, accompagnement, saisons, etapes, user_id) values ('Gratin de courgettes', 'normal', true, 'legumes', array['ete'], array['Couper les courgettes en rondelles et les faire suer.', 'Mélanger avec œufs et crème.', 'Verser dans un plat, couvrir de fromage.', 'Cuire 30 min au four à 180°C.'], null) returning id into rid;
  insert into recette_ingredient (recette_id, ingredient_id, quantite, unite)
    select rid, ing.id, v.quantite, v.unite from (values
    ('courgettes', 'legumes-fruits', false, 4, 'piece'),
    ('œufs', 'produits-frais', false, 2, 'piece'),
    ('crème fraîche', 'produits-frais', false, 15, 'cl'),
    ('fromage râpé', 'produits-frais', false, 100, 'g')
    ) as v(nom, categorie, fond, quantite, unite)
    join ingredient ing on ing.nom = v.nom and ing.categorie = v.categorie and ing.fond_de_placard = v.fond;
  insert into recette (nom, temps_preparation, vegetarien, accompagnement, saisons, etapes, user_id) values ('Risotto aux champignons', 'normal', true, 'feculents', array['automne'], array['Faire revenir les champignons, réserver.', 'Nacrer le riz puis mouiller progressivement de bouillon.', 'Remuer jusqu''à absorption complète.', 'Ajouter les champignons et le parmesan en fin de cuisson.'], null) returning id into rid;
  insert into recette_ingredient (recette_id, ingredient_id, quantite, unite)
    select rid, ing.id, v.quantite, v.unite from (values
    ('riz à risotto', 'epicerie', true, 250, 'g'),
    ('champignons de Paris', 'legumes-fruits', false, 300, 'g'),
    ('bouillon de légumes', 'epicerie', true, 1, 'l'),
    ('parmesan', 'produits-frais', false, 50, 'g')
    ) as v(nom, categorie, fond, quantite, unite)
    join ingredient ing on ing.nom = v.nom and ing.categorie = v.categorie and ing.fond_de_placard = v.fond;
  insert into recette (nom, temps_preparation, vegetarien, accompagnement, saisons, etapes, user_id) values ('Risotto aux crevettes', 'normal', false, 'feculents', null, array['Nacrer le riz.', 'Mouiller progressivement de bouillon en remuant.', 'Ajouter les crevettes en fin de cuisson.', 'Terminer avec le parmesan.'], null) returning id into rid;
  insert into recette_ingredient (recette_id, ingredient_id, quantite, unite)
    select rid, ing.id, v.quantite, v.unite from (values
    ('riz à risotto', 'epicerie', true, 250, 'g'),
    ('crevettes décortiquées', 'surgeles', true, 250, 'g'),
    ('bouillon de poisson', 'epicerie', true, 1, 'l'),
    ('parmesan', 'produits-frais', false, 30, 'g')
    ) as v(nom, categorie, fond, quantite, unite)
    join ingredient ing on ing.nom = v.nom and ing.categorie = v.categorie and ing.fond_de_placard = v.fond;
  insert into recette (nom, temps_preparation, vegetarien, accompagnement, saisons, etapes, user_id) values ('Tajine de poulet aux abricots', 'normal', false, 'feculents', null, array['Faire dorer le poulet avec l''oignon et les épices.', 'Ajouter les abricots secs et un peu d''eau.', 'Laisser mijoter 30 min à couvert.', 'Servir avec la semoule.'], null) returning id into rid;
  insert into recette_ingredient (recette_id, ingredient_id, quantite, unite)
    select rid, ing.id, v.quantite, v.unite from (values
    ('cuisses de poulet', 'viandes-poissons', false, 4, 'piece'),
    ('abricots secs', 'epicerie', true, 150, 'g'),
    ('oignon', 'legumes-fruits', true, 1, 'piece'),
    ('épices à tajine', 'epicerie', true, 1, 'cas'),
    ('semoule', 'epicerie', true, 200, 'g')
    ) as v(nom, categorie, fond, quantite, unite)
    join ingredient ing on ing.nom = v.nom and ing.categorie = v.categorie and ing.fond_de_placard = v.fond;
  insert into recette (nom, temps_preparation, vegetarien, accompagnement, saisons, etapes, user_id) values ('Couscous royal', 'normal', false, 'feculents', array['automne'], array['Cuire l''agneau et les carottes dans un bouillon épicé.', 'Griller les merguez à part.', 'Ajouter les pois chiches en fin de cuisson.', 'Faire gonfler la semoule et servir le tout.'], null) returning id into rid;
  insert into recette_ingredient (recette_id, ingredient_id, quantite, unite)
    select rid, ing.id, v.quantite, v.unite from (values
    ('semoule', 'epicerie', true, 250, 'g'),
    ('merguez', 'viandes-poissons', false, 4, 'piece'),
    ('agneau en morceaux', 'viandes-poissons', false, 300, 'g'),
    ('carottes', 'legumes-fruits', true, 3, 'piece'),
    ('pois chiches', 'epicerie', true, 1, 'boite')
    ) as v(nom, categorie, fond, quantite, unite)
    join ingredient ing on ing.nom = v.nom and ing.categorie = v.categorie and ing.fond_de_placard = v.fond;
  insert into recette (nom, temps_preparation, vegetarien, accompagnement, saisons, etapes, user_id) values ('Couscous végétarien', 'normal', true, 'feculents', array['automne'], array['Cuire les légumes dans un bouillon épicé.', 'Ajouter les pois chiches en fin de cuisson.', 'Faire gonfler la semoule.', 'Servir légumes et semoule ensemble.'], null) returning id into rid;
  insert into recette_ingredient (recette_id, ingredient_id, quantite, unite)
    select rid, ing.id, v.quantite, v.unite from (values
    ('semoule', 'epicerie', true, 250, 'g'),
    ('carottes', 'legumes-fruits', true, 3, 'piece'),
    ('courgettes', 'legumes-fruits', false, 2, 'piece'),
    ('pois chiches', 'epicerie', true, 1, 'boite'),
    ('épices à couscous', 'epicerie', true, 1, 'cas')
    ) as v(nom, categorie, fond, quantite, unite)
    join ingredient ing on ing.nom = v.nom and ing.categorie = v.categorie and ing.fond_de_placard = v.fond;
  insert into recette (nom, temps_preparation, vegetarien, accompagnement, saisons, etapes, user_id) values ('Poêlée de porc au caramel, riz', 'normal', false, 'feculents', null, array['Couper le porc en morceaux.', 'Faire caraméliser le sucre puis ajouter le porc et la sauce soja.', 'Laisser mijoter 15 min.', 'Servir avec le riz.'], null) returning id into rid;
  insert into recette_ingredient (recette_id, ingredient_id, quantite, unite)
    select rid, ing.id, v.quantite, v.unite from (values
    ('filet de porc', 'viandes-poissons', false, 400, 'g'),
    ('sauce soja', 'epicerie', true, 3, 'cas'),
    ('sucre roux', 'epicerie', true, 2, 'cas'),
    ('riz basmati', 'epicerie', true, 200, 'g')
    ) as v(nom, categorie, fond, quantite, unite)
    join ingredient ing on ing.nom = v.nom and ing.categorie = v.categorie and ing.fond_de_placard = v.fond;
  insert into recette (nom, temps_preparation, vegetarien, accompagnement, saisons, etapes, user_id) values ('Gratin de pommes de terre au saumon', 'normal', false, 'feculents', null, array['Cuire les pommes de terre en rondelles à la vapeur.', 'Disposer en couches avec le saumon et la crème.', 'Couvrir de fromage.', 'Gratiner au four 25 min.'], null) returning id into rid;
  insert into recette_ingredient (recette_id, ingredient_id, quantite, unite)
    select rid, ing.id, v.quantite, v.unite from (values
    ('pommes de terre', 'legumes-fruits', true, 600, 'g'),
    ('saumon fumé', 'viandes-poissons', false, 150, 'g'),
    ('crème fraîche', 'produits-frais', false, 20, 'cl'),
    ('fromage râpé', 'produits-frais', false, 80, 'g')
    ) as v(nom, categorie, fond, quantite, unite)
    join ingredient ing on ing.nom = v.nom and ing.categorie = v.categorie and ing.fond_de_placard = v.fond;
  insert into recette (nom, temps_preparation, vegetarien, accompagnement, saisons, etapes, user_id) values ('Lasagnes à la bolognaise', 'normal', false, 'feculents', null, array['Préparer la sauce bolognaise avec le bœuf haché et la sauce tomate.', 'Monter les lasagnes en couches avec béchamel.', 'Couvrir de fromage râpé.', 'Cuire 40 min au four à 180°C.'], null) returning id into rid;
  insert into recette_ingredient (recette_id, ingredient_id, quantite, unite)
    select rid, ing.id, v.quantite, v.unite from (values
    ('plaques de lasagnes', 'epicerie', true, 250, 'g'),
    ('bœuf haché', 'viandes-poissons', false, 400, 'g'),
    ('sauce tomate', 'epicerie', true, 500, 'g'),
    ('béchamel', 'epicerie', false, 500, 'ml'),
    ('fromage râpé', 'produits-frais', false, 100, 'g')
    ) as v(nom, categorie, fond, quantite, unite)
    join ingredient ing on ing.nom = v.nom and ing.categorie = v.categorie and ing.fond_de_placard = v.fond;
  insert into recette (nom, temps_preparation, vegetarien, accompagnement, saisons, etapes, user_id) values ('Lasagnes aux légumes', 'normal', true, 'feculents', array['ete'], array['Faire revenir les légumes coupés en dés.', 'Monter les lasagnes en couches avec béchamel.', 'Couvrir de fromage râpé.', 'Cuire 40 min au four à 180°C.'], null) returning id into rid;
  insert into recette_ingredient (recette_id, ingredient_id, quantite, unite)
    select rid, ing.id, v.quantite, v.unite from (values
    ('plaques de lasagnes', 'epicerie', true, 250, 'g'),
    ('courgettes', 'legumes-fruits', false, 2, 'piece'),
    ('aubergine', 'legumes-fruits', false, 1, 'piece'),
    ('béchamel', 'epicerie', false, 500, 'ml'),
    ('fromage râpé', 'produits-frais', false, 100, 'g')
    ) as v(nom, categorie, fond, quantite, unite)
    join ingredient ing on ing.nom = v.nom and ing.categorie = v.categorie and ing.fond_de_placard = v.fond;
  insert into recette (nom, temps_preparation, vegetarien, accompagnement, saisons, etapes, user_id) values ('Moussaka', 'normal', false, 'legumes', array['automne'], array['Faire griller les tranches d''aubergine.', 'Préparer la viande hachée à la tomate.', 'Monter en couches aubergines/viande, couvrir de béchamel.', 'Cuire 35 min au four à 180°C.'], null) returning id into rid;
  insert into recette_ingredient (recette_id, ingredient_id, quantite, unite)
    select rid, ing.id, v.quantite, v.unite from (values
    ('aubergines', 'legumes-fruits', false, 3, 'piece'),
    ('agneau haché', 'viandes-poissons', false, 400, 'g'),
    ('sauce tomate', 'epicerie', true, 300, 'g'),
    ('béchamel', 'epicerie', false, 400, 'ml')
    ) as v(nom, categorie, fond, quantite, unite)
    join ingredient ing on ing.nom = v.nom and ing.categorie = v.categorie and ing.fond_de_placard = v.fond;
  insert into recette (nom, temps_preparation, vegetarien, accompagnement, saisons, etapes, user_id) values ('Parmentier de canard', 'normal', false, 'feculents', array['hiver'], array['Effilocher la chair de canard.', 'Préparer une purée avec les pommes de terre, lait et beurre.', 'Monter en couches canard/purée.', 'Gratiner au four 20 min.'], null) returning id into rid;
  insert into recette_ingredient (recette_id, ingredient_id, quantite, unite)
    select rid, ing.id, v.quantite, v.unite from (values
    ('cuisses de canard confites', 'viandes-poissons', false, 2, 'piece'),
    ('pommes de terre', 'legumes-fruits', true, 600, 'g'),
    ('lait', 'produits-frais', false, 100, 'ml'),
    ('beurre', 'produits-frais', true, 30, 'g')
    ) as v(nom, categorie, fond, quantite, unite)
    join ingredient ing on ing.nom = v.nom and ing.categorie = v.categorie and ing.fond_de_placard = v.fond;
  insert into recette (nom, temps_preparation, vegetarien, accompagnement, saisons, etapes, user_id) values ('Hachis parmentier', 'normal', false, 'feculents', array['hiver'], array['Faire revenir le bœuf haché.', 'Préparer une purée avec pommes de terre, lait et beurre.', 'Monter en couches viande/purée.', 'Gratiner au four 20 min.'], null) returning id into rid;
  insert into recette_ingredient (recette_id, ingredient_id, quantite, unite)
    select rid, ing.id, v.quantite, v.unite from (values
    ('bœuf haché', 'viandes-poissons', false, 400, 'g'),
    ('pommes de terre', 'legumes-fruits', true, 600, 'g'),
    ('lait', 'produits-frais', false, 100, 'ml'),
    ('beurre', 'produits-frais', true, 30, 'g')
    ) as v(nom, categorie, fond, quantite, unite)
    join ingredient ing on ing.nom = v.nom and ing.categorie = v.categorie and ing.fond_de_placard = v.fond;
  insert into recette (nom, temps_preparation, vegetarien, accompagnement, saisons, etapes, user_id) values ('Curry de poisson au lait de coco, riz', 'normal', false, 'feculents', null, array['Faire revenir le curry en poudre quelques secondes.', 'Ajouter le lait de coco et porter à frémissement.', 'Ajouter le poisson en morceaux, cuire 10 min.', 'Servir avec le riz.'], null) returning id into rid;
  insert into recette_ingredient (recette_id, ingredient_id, quantite, unite)
    select rid, ing.id, v.quantite, v.unite from (values
    ('filet de poisson blanc', 'viandes-poissons', false, 400, 'g'),
    ('lait de coco', 'epicerie', true, 400, 'ml'),
    ('curry en poudre', 'epicerie', true, 1, 'cas'),
    ('riz basmati', 'epicerie', true, 200, 'g')
    ) as v(nom, categorie, fond, quantite, unite)
    join ingredient ing on ing.nom = v.nom and ing.categorie = v.categorie and ing.fond_de_placard = v.fond;
  insert into recette (nom, temps_preparation, vegetarien, accompagnement, saisons, etapes, user_id) values ('Poulet au citron confit, semoule', 'normal', false, 'feculents', null, array['Faire dorer le poulet.', 'Ajouter le citron confit émincé et les olives.', 'Laisser mijoter 30 min.', 'Servir avec la semoule.'], null) returning id into rid;
  insert into recette_ingredient (recette_id, ingredient_id, quantite, unite)
    select rid, ing.id, v.quantite, v.unite from (values
    ('cuisses de poulet', 'viandes-poissons', false, 4, 'piece'),
    ('citron confit', 'epicerie', false, 2, 'piece'),
    ('olives vertes', 'epicerie', false, 100, 'g'),
    ('semoule', 'epicerie', true, 200, 'g')
    ) as v(nom, categorie, fond, quantite, unite)
    join ingredient ing on ing.nom = v.nom and ing.categorie = v.categorie and ing.fond_de_placard = v.fond;
  insert into recette (nom, temps_preparation, vegetarien, accompagnement, saisons, etapes, user_id) values ('Filet mignon de porc à la moutarde', 'normal', false, 'legumes', null, array['Faire dorer le filet mignon entier.', 'Ajouter la moutarde et la crème, laisser mijoter 20 min.', 'Cuire les haricots verts.', 'Trancher le filet et napper de sauce.'], null) returning id into rid;
  insert into recette_ingredient (recette_id, ingredient_id, quantite, unite)
    select rid, ing.id, v.quantite, v.unite from (values
    ('filet mignon de porc', 'viandes-poissons', false, 500, 'g'),
    ('moutarde', 'epicerie', true, 2, 'cas'),
    ('crème fraîche', 'produits-frais', false, 20, 'cl'),
    ('haricots verts', 'surgeles', true, 400, 'g')
    ) as v(nom, categorie, fond, quantite, unite)
    join ingredient ing on ing.nom = v.nom and ing.categorie = v.categorie and ing.fond_de_placard = v.fond;
  insert into recette (nom, temps_preparation, vegetarien, accompagnement, saisons, etapes, user_id) values ('Poêlée de légumes d''été et halloumi', 'normal', true, 'legumes', array['ete'], array['Couper les légumes en morceaux et les faire griller.', 'Griller les tranches d''halloumi à la poêle.', 'Réunir légumes et halloumi.', 'Arroser d''huile d''olive avant de servir.'], null) returning id into rid;
  insert into recette_ingredient (recette_id, ingredient_id, quantite, unite)
    select rid, ing.id, v.quantite, v.unite from (values
    ('courgettes', 'legumes-fruits', false, 2, 'piece'),
    ('poivrons', 'legumes-fruits', false, 2, 'piece'),
    ('aubergine', 'legumes-fruits', false, 1, 'piece'),
    ('halloumi', 'produits-frais', false, 200, 'g')
    ) as v(nom, categorie, fond, quantite, unite)
    join ingredient ing on ing.nom = v.nom and ing.categorie = v.categorie and ing.fond_de_placard = v.fond;
  insert into recette (nom, temps_preparation, vegetarien, accompagnement, saisons, etapes, user_id) values ('Ratatouille et riz', 'normal', true, 'feculents', array['ete'], array['Couper tous les légumes en dés.', 'Les faire mijoter ensemble avec un filet d''huile d''olive 30 min.', 'Cuire le riz.', 'Servir la ratatouille avec le riz.'], null) returning id into rid;
  insert into recette_ingredient (recette_id, ingredient_id, quantite, unite)
    select rid, ing.id, v.quantite, v.unite from (values
    ('courgettes', 'legumes-fruits', false, 2, 'piece'),
    ('aubergine', 'legumes-fruits', false, 1, 'piece'),
    ('poivrons', 'legumes-fruits', false, 2, 'piece'),
    ('tomates', 'legumes-fruits', false, 4, 'piece'),
    ('riz basmati', 'epicerie', true, 200, 'g')
    ) as v(nom, categorie, fond, quantite, unite)
    join ingredient ing on ing.nom = v.nom and ing.categorie = v.categorie and ing.fond_de_placard = v.fond;
  insert into recette (nom, temps_preparation, vegetarien, accompagnement, saisons, etapes, user_id) values ('Gnocchis, sauce tomate et burrata', 'normal', true, 'feculents', null, array['Faire chauffer la sauce tomate.', 'Cuire les gnocchis dans l''eau bouillante.', 'Mélanger gnocchis et sauce.', 'Déposer la burrata et le basilic avant de servir.'], null) returning id into rid;
  insert into recette_ingredient (recette_id, ingredient_id, quantite, unite)
    select rid, ing.id, v.quantite, v.unite from (values
    ('gnocchis', 'epicerie', true, 400, 'g'),
    ('sauce tomate', 'epicerie', true, 300, 'g'),
    ('burrata', 'produits-frais', false, 1, 'piece'),
    ('basilic', 'legumes-fruits', false, 1, 'piece')
    ) as v(nom, categorie, fond, quantite, unite)
    join ingredient ing on ing.nom = v.nom and ing.categorie = v.categorie and ing.fond_de_placard = v.fond;
  insert into recette (nom, temps_preparation, vegetarien, accompagnement, saisons, etapes, user_id) values ('Poulet chasseur', 'normal', false, 'feculents', array['automne'], array['Faire dorer le poulet.', 'Ajouter les champignons puis déglacer au vin blanc.', 'Ajouter la sauce tomate.', 'Laisser mijoter 30 min.'], null) returning id into rid;
  insert into recette_ingredient (recette_id, ingredient_id, quantite, unite)
    select rid, ing.id, v.quantite, v.unite from (values
    ('cuisses de poulet', 'viandes-poissons', false, 4, 'piece'),
    ('champignons de Paris', 'legumes-fruits', false, 250, 'g'),
    ('sauce tomate', 'epicerie', true, 200, 'g'),
    ('vin blanc', 'epicerie', true, 100, 'ml')
    ) as v(nom, categorie, fond, quantite, unite)
    join ingredient ing on ing.nom = v.nom and ing.categorie = v.categorie and ing.fond_de_placard = v.fond;
  insert into recette (nom, temps_preparation, vegetarien, accompagnement, saisons, etapes, user_id) values ('Sauté de dinde aux poivrons', 'normal', false, 'legumes', null, array['Couper la dinde et les poivrons en lanières.', 'Faire sauter à feu vif avec l''oignon.', 'Ajouter la sauce soja.', 'Servir chaud.'], null) returning id into rid;
  insert into recette_ingredient (recette_id, ingredient_id, quantite, unite)
    select rid, ing.id, v.quantite, v.unite from (values
    ('escalope de dinde', 'viandes-poissons', false, 400, 'g'),
    ('poivrons', 'legumes-fruits', false, 3, 'piece'),
    ('oignon', 'legumes-fruits', true, 1, 'piece'),
    ('sauce soja', 'epicerie', true, 2, 'cas')
    ) as v(nom, categorie, fond, quantite, unite)
    join ingredient ing on ing.nom = v.nom and ing.categorie = v.categorie and ing.fond_de_placard = v.fond;
  insert into recette (nom, temps_preparation, vegetarien, accompagnement, saisons, etapes, user_id) values ('Cassolette de la mer', 'normal', false, 'feculents', array['hiver'], array['Faire revenir les champignons.', 'Ajouter les fruits de mer puis la crème.', 'Laisser mijoter 15 min.', 'Servir avec le riz.'], null) returning id into rid;
  insert into recette_ingredient (recette_id, ingredient_id, quantite, unite)
    select rid, ing.id, v.quantite, v.unite from (values
    ('fruits de mer surgelés', 'surgeles', true, 400, 'g'),
    ('crème fraîche', 'produits-frais', false, 20, 'cl'),
    ('champignons de Paris', 'legumes-fruits', false, 200, 'g'),
    ('riz basmati', 'epicerie', true, 200, 'g')
    ) as v(nom, categorie, fond, quantite, unite)
    join ingredient ing on ing.nom = v.nom and ing.categorie = v.categorie and ing.fond_de_placard = v.fond;
  insert into recette (nom, temps_preparation, vegetarien, accompagnement, saisons, etapes, user_id) values ('Endives au jambon gratinées', 'normal', false, null, array['hiver'], array['Cuire les endives à l''eau ou au four.', 'Les enrouler dans le jambon.', 'Napper de béchamel et de fromage.', 'Gratiner au four 20 min.'], null) returning id into rid;
  insert into recette_ingredient (recette_id, ingredient_id, quantite, unite)
    select rid, ing.id, v.quantite, v.unite from (values
    ('endives', 'legumes-fruits', false, 8, 'piece'),
    ('jambon', 'viandes-poissons', false, 8, 'piece'),
    ('béchamel', 'epicerie', false, 500, 'ml'),
    ('fromage râpé', 'produits-frais', false, 100, 'g')
    ) as v(nom, categorie, fond, quantite, unite)
    join ingredient ing on ing.nom = v.nom and ing.categorie = v.categorie and ing.fond_de_placard = v.fond;
  insert into recette (nom, temps_preparation, vegetarien, accompagnement, saisons, etapes, user_id) values ('Gratin de chou-fleur au jambon', 'normal', false, null, array['hiver'], array['Cuire le chou-fleur en bouquets.', 'Disposer avec le jambon dans un plat.', 'Napper de béchamel et de fromage.', 'Gratiner au four 25 min.'], null) returning id into rid;
  insert into recette_ingredient (recette_id, ingredient_id, quantite, unite)
    select rid, ing.id, v.quantite, v.unite from (values
    ('chou-fleur', 'legumes-fruits', false, 1, 'piece'),
    ('jambon', 'viandes-poissons', false, 150, 'g'),
    ('béchamel', 'epicerie', false, 500, 'ml'),
    ('fromage râpé', 'produits-frais', false, 100, 'g')
    ) as v(nom, categorie, fond, quantite, unite)
    join ingredient ing on ing.nom = v.nom and ing.categorie = v.categorie and ing.fond_de_placard = v.fond;
  insert into recette (nom, temps_preparation, vegetarien, accompagnement, saisons, etapes, user_id) values ('Chou farci', 'normal', false, 'legumes', array['hiver'], array['Blanchir les feuilles de chou.', 'Mélanger la viande, le riz cuit et l''oignon.', 'Garnir les feuilles et les rouler.', 'Cuire à l''étouffée 40 min.'], null) returning id into rid;
  insert into recette_ingredient (recette_id, ingredient_id, quantite, unite)
    select rid, ing.id, v.quantite, v.unite from (values
    ('chou vert', 'legumes-fruits', false, 1, 'piece'),
    ('bœuf haché', 'viandes-poissons', false, 400, 'g'),
    ('riz basmati', 'epicerie', true, 100, 'g'),
    ('oignon', 'legumes-fruits', true, 1, 'piece')
    ) as v(nom, categorie, fond, quantite, unite)
    join ingredient ing on ing.nom = v.nom and ing.categorie = v.categorie and ing.fond_de_placard = v.fond;
  insert into recette (nom, temps_preparation, vegetarien, accompagnement, saisons, etapes, user_id) values ('Falafels, salade et houmous', 'normal', true, 'legumes', null, array['Cuire les falafels au four ou à la poêle.', 'Garnir les pains pita de salade et houmous.', 'Ajouter les falafels.', 'Servir chaud.'], null) returning id into rid;
  insert into recette_ingredient (recette_id, ingredient_id, quantite, unite)
    select rid, ing.id, v.quantite, v.unite from (values
    ('falafels', 'surgeles', false, 12, 'piece'),
    ('salade verte', 'legumes-fruits', false, 1, 'piece'),
    ('houmous', 'epicerie', false, 150, 'g'),
    ('pain pita', 'boulangerie', true, 4, 'piece')
    ) as v(nom, categorie, fond, quantite, unite)
    join ingredient ing on ing.nom = v.nom and ing.categorie = v.categorie and ing.fond_de_placard = v.fond;
  insert into recette (nom, temps_preparation, vegetarien, accompagnement, saisons, etapes, user_id) values ('Curry de légumes et pois chiches', 'normal', true, 'legumes', null, array['Faire revenir le curry en poudre.', 'Ajouter les légumes et les pois chiches.', 'Mouiller de lait de coco, laisser mijoter 20 min.', 'Servir avec le riz.'], null) returning id into rid;
  insert into recette_ingredient (recette_id, ingredient_id, quantite, unite)
    select rid, ing.id, v.quantite, v.unite from (values
    ('pois chiches cuits', 'epicerie', true, 400, 'g'),
    ('courgettes', 'legumes-fruits', false, 2, 'piece'),
    ('lait de coco', 'epicerie', true, 300, 'ml'),
    ('curry en poudre', 'epicerie', true, 1, 'cas'),
    ('riz basmati', 'epicerie', true, 200, 'g')
    ) as v(nom, categorie, fond, quantite, unite)
    join ingredient ing on ing.nom = v.nom and ing.categorie = v.categorie and ing.fond_de_placard = v.fond;
  insert into recette (nom, temps_preparation, vegetarien, accompagnement, saisons, etapes, user_id) values ('Poêlée de poulet, champignons, tagliatelles', 'normal', false, 'feculents', array['automne'], array['Cuire les tagliatelles.', 'Poêler le poulet coupé en lamelles.', 'Ajouter les champignons puis la crème.', 'Mélanger aux tagliatelles.'], null) returning id into rid;
  insert into recette_ingredient (recette_id, ingredient_id, quantite, unite)
    select rid, ing.id, v.quantite, v.unite from (values
    ('blanc de poulet', 'viandes-poissons', false, 2, 'piece'),
    ('champignons de Paris', 'legumes-fruits', false, 250, 'g'),
    ('crème fraîche', 'produits-frais', false, 15, 'cl'),
    ('tagliatelles', 'epicerie', true, 200, 'g')
    ) as v(nom, categorie, fond, quantite, unite)
    join ingredient ing on ing.nom = v.nom and ing.categorie = v.categorie and ing.fond_de_placard = v.fond;
  insert into recette (nom, temps_preparation, vegetarien, accompagnement, saisons, etapes, user_id) values ('Terrine de légumes et quinoa', 'normal', true, 'legumes', array['printemps'], array['Cuire le quinoa et les légumes en dés.', 'Mélanger avec les œufs battus.', 'Verser dans un moule à cake.', 'Cuire 40 min au four à 180°C.'], null) returning id into rid;
  insert into recette_ingredient (recette_id, ingredient_id, quantite, unite)
    select rid, ing.id, v.quantite, v.unite from (values
    ('quinoa', 'epicerie', true, 150, 'g'),
    ('courgettes', 'legumes-fruits', false, 2, 'piece'),
    ('carottes', 'legumes-fruits', true, 2, 'piece'),
    ('œufs', 'produits-frais', false, 3, 'piece')
    ) as v(nom, categorie, fond, quantite, unite)
    join ingredient ing on ing.nom = v.nom and ing.categorie = v.categorie and ing.fond_de_placard = v.fond;
  insert into recette (nom, temps_preparation, vegetarien, accompagnement, saisons, etapes, user_id) values ('Gratin de pâtes au thon', 'normal', false, 'feculents', null, array['Cuire les pâtes.', 'Mélanger avec le thon émietté et la béchamel.', 'Verser dans un plat, couvrir de fromage.', 'Gratiner au four 20 min.'], null) returning id into rid;
  insert into recette_ingredient (recette_id, ingredient_id, quantite, unite)
    select rid, ing.id, v.quantite, v.unite from (values
    ('macaronis', 'epicerie', true, 250, 'g'),
    ('thon au naturel', 'viandes-poissons', true, 2, 'boite'),
    ('béchamel', 'epicerie', false, 400, 'ml'),
    ('fromage râpé', 'produits-frais', false, 80, 'g')
    ) as v(nom, categorie, fond, quantite, unite)
    join ingredient ing on ing.nom = v.nom and ing.categorie = v.categorie and ing.fond_de_placard = v.fond;
  insert into recette (nom, temps_preparation, vegetarien, accompagnement, saisons, etapes, user_id) values ('Bœuf carottes', 'long', false, 'legumes', array['hiver'], array['Faire dorer la viande en morceaux.', 'Ajouter oignon et carottes.', 'Mouiller avec le bouillon.', 'Laisser mijoter 2h à couvert.'], null) returning id into rid;
  insert into recette_ingredient (recette_id, ingredient_id, quantite, unite)
    select rid, ing.id, v.quantite, v.unite from (values
    ('bœuf à braiser', 'viandes-poissons', false, 600, 'g'),
    ('carottes', 'legumes-fruits', true, 500, 'g'),
    ('oignon', 'legumes-fruits', true, 1, 'piece'),
    ('bouillon de bœuf', 'epicerie', true, 1, 'piece')
    ) as v(nom, categorie, fond, quantite, unite)
    join ingredient ing on ing.nom = v.nom and ing.categorie = v.categorie and ing.fond_de_placard = v.fond;
  insert into recette (nom, temps_preparation, vegetarien, accompagnement, saisons, etapes, user_id) values ('Rôti de bœuf, gratin dauphinois', 'long', false, 'feculents', null, array['Préparer le gratin dauphinois (pommes de terre, crème, ail) et enfourner 1h.', 'Saisir le rôti sur toutes les faces.', 'Poursuivre la cuisson au four selon le poids.', 'Laisser reposer avant de trancher.'], null) returning id into rid;
  insert into recette_ingredient (recette_id, ingredient_id, quantite, unite)
    select rid, ing.id, v.quantite, v.unite from (values
    ('rôti de bœuf', 'viandes-poissons', false, 800, 'g'),
    ('pommes de terre', 'legumes-fruits', true, 800, 'g'),
    ('crème fraîche', 'produits-frais', false, 30, 'cl'),
    ('ail', 'legumes-fruits', true, 2, 'piece')
    ) as v(nom, categorie, fond, quantite, unite)
    join ingredient ing on ing.nom = v.nom and ing.categorie = v.categorie and ing.fond_de_placard = v.fond;
  insert into recette (nom, temps_preparation, vegetarien, accompagnement, saisons, etapes, user_id) values ('Épaule d''agneau confite, flageolets', 'long', false, 'feculents', array['printemps'], array['Saisir l''épaule d''agneau.', 'L''enfourner à basse température avec ail et thym pendant 3h.', 'Réchauffer les flageolets.', 'Servir l''agneau effiloché avec les flageolets.'], null) returning id into rid;
  insert into recette_ingredient (recette_id, ingredient_id, quantite, unite)
    select rid, ing.id, v.quantite, v.unite from (values
    ('épaule d''agneau', 'viandes-poissons', false, 1, 'piece'),
    ('flageolets', 'epicerie', true, 2, 'boite'),
    ('ail', 'legumes-fruits', true, 4, 'piece'),
    ('thym', 'legumes-fruits', true, 2, 'piece')
    ) as v(nom, categorie, fond, quantite, unite)
    join ingredient ing on ing.nom = v.nom and ing.categorie = v.categorie and ing.fond_de_placard = v.fond;
  insert into recette (nom, temps_preparation, vegetarien, accompagnement, saisons, etapes, user_id) values ('Poule au pot', 'long', false, 'legumes', array['hiver'], array['Placer la poule et les légumes dans une grande marmite d''eau.', 'Porter à ébullition puis laisser mijoter 2h30.', 'Écumer régulièrement.', 'Servir le bouillon puis la poule et les légumes.'], null) returning id into rid;
  insert into recette_ingredient (recette_id, ingredient_id, quantite, unite)
    select rid, ing.id, v.quantite, v.unite from (values
    ('poule', 'viandes-poissons', false, 1, 'piece'),
    ('carottes', 'legumes-fruits', true, 4, 'piece'),
    ('poireaux', 'legumes-fruits', false, 3, 'piece'),
    ('navets', 'legumes-fruits', false, 3, 'piece')
    ) as v(nom, categorie, fond, quantite, unite)
    join ingredient ing on ing.nom = v.nom and ing.categorie = v.categorie and ing.fond_de_placard = v.fond;
  insert into recette (nom, temps_preparation, vegetarien, accompagnement, saisons, etapes, user_id) values ('Osso bucco, riz', 'long', false, 'feculents', array['hiver'], array['Faire dorer les jarrets de veau.', 'Ajouter les carottes et les tomates concassées.', 'Laisser mijoter 1h30 à couvert.', 'Servir avec le riz.'], null) returning id into rid;
  insert into recette_ingredient (recette_id, ingredient_id, quantite, unite)
    select rid, ing.id, v.quantite, v.unite from (values
    ('jarret de veau', 'viandes-poissons', false, 4, 'piece'),
    ('tomates concassées', 'epicerie', true, 400, 'g'),
    ('carottes', 'legumes-fruits', true, 2, 'piece'),
    ('riz basmati', 'epicerie', true, 200, 'g')
    ) as v(nom, categorie, fond, quantite, unite)
    join ingredient ing on ing.nom = v.nom and ing.categorie = v.categorie and ing.fond_de_placard = v.fond;
  insert into recette (nom, temps_preparation, vegetarien, accompagnement, saisons, etapes, user_id) values ('Joue de bœuf braisée, purée', 'long', false, 'feculents', array['hiver'], array['Faire mariner puis dorer les joues de bœuf.', 'Mouiller au vin rouge, ajouter les carottes.', 'Laisser mijoter 3h à couvert.', 'Servir avec une purée de pommes de terre.'], null) returning id into rid;
  insert into recette_ingredient (recette_id, ingredient_id, quantite, unite)
    select rid, ing.id, v.quantite, v.unite from (values
    ('joues de bœuf', 'viandes-poissons', false, 4, 'piece'),
    ('vin rouge', 'epicerie', true, 300, 'ml'),
    ('carottes', 'legumes-fruits', true, 2, 'piece'),
    ('pommes de terre', 'legumes-fruits', true, 500, 'g')
    ) as v(nom, categorie, fond, quantite, unite)
    join ingredient ing on ing.nom = v.nom and ing.categorie = v.categorie and ing.fond_de_placard = v.fond;
  insert into recette (nom, temps_preparation, vegetarien, accompagnement, saisons, etapes, user_id) values ('Confit de canard, pommes sarladaises', 'long', false, 'feculents', array['hiver'], array['Faire dorer les cuisses de canard confites.', 'Cuire les pommes de terre en dés dans la graisse de canard.', 'Ajouter l''ail et le persil en fin de cuisson.', 'Servir ensemble.'], null) returning id into rid;
  insert into recette_ingredient (recette_id, ingredient_id, quantite, unite)
    select rid, ing.id, v.quantite, v.unite from (values
    ('cuisses de canard confites', 'viandes-poissons', false, 4, 'piece'),
    ('pommes de terre', 'legumes-fruits', true, 600, 'g'),
    ('ail', 'legumes-fruits', true, 3, 'piece'),
    ('persil', 'legumes-fruits', false, 1, 'piece')
    ) as v(nom, categorie, fond, quantite, unite)
    join ingredient ing on ing.nom = v.nom and ing.categorie = v.categorie and ing.fond_de_placard = v.fond;
  insert into recette (nom, temps_preparation, vegetarien, accompagnement, saisons, etapes, user_id) values ('Paella', 'long', false, 'feculents', array['ete'], array['Faire dorer le poulet.', 'Ajouter le riz et le safran, mouiller de bouillon.', 'Ajouter crevettes et moules en fin de cuisson.', 'Laisser reposer quelques minutes avant de servir.'], null) returning id into rid;
  insert into recette_ingredient (recette_id, ingredient_id, quantite, unite)
    select rid, ing.id, v.quantite, v.unite from (values
    ('riz à risotto', 'epicerie', true, 300, 'g'),
    ('poulet', 'viandes-poissons', false, 300, 'g'),
    ('crevettes', 'surgeles', true, 200, 'g'),
    ('moules', 'viandes-poissons', false, 300, 'g'),
    ('safran', 'epicerie', true, 1, 'sachet')
    ) as v(nom, categorie, fond, quantite, unite)
    join ingredient ing on ing.nom = v.nom and ing.categorie = v.categorie and ing.fond_de_placard = v.fond;
  insert into recette (nom, temps_preparation, vegetarien, accompagnement, saisons, etapes, user_id) values ('Paella végétarienne', 'long', true, 'feculents', array['ete'], array['Faire revenir les poivrons.', 'Ajouter le riz et le safran, mouiller de bouillon de légumes.', 'Ajouter artichauts et petits pois.', 'Laisser reposer avant de servir.'], null) returning id into rid;
  insert into recette_ingredient (recette_id, ingredient_id, quantite, unite)
    select rid, ing.id, v.quantite, v.unite from (values
    ('riz à risotto', 'epicerie', true, 300, 'g'),
    ('poivrons', 'legumes-fruits', false, 2, 'piece'),
    ('artichauts', 'epicerie', false, 1, 'boite'),
    ('petits pois', 'surgeles', true, 150, 'g'),
    ('safran', 'epicerie', true, 1, 'sachet')
    ) as v(nom, categorie, fond, quantite, unite)
    join ingredient ing on ing.nom = v.nom and ing.categorie = v.categorie and ing.fond_de_placard = v.fond;
  insert into recette (nom, temps_preparation, vegetarien, accompagnement, saisons, etapes, user_id) values ('Gratin dauphinois et rôti de porc', 'long', false, 'feculents', null, array['Préparer le gratin dauphinois et enfourner 1h.', 'Saisir le rôti de porc.', 'Poursuivre sa cuisson au four.', 'Servir le rôti tranché avec le gratin.'], null) returning id into rid;
  insert into recette_ingredient (recette_id, ingredient_id, quantite, unite)
    select rid, ing.id, v.quantite, v.unite from (values
    ('rôti de porc', 'viandes-poissons', false, 800, 'g'),
    ('pommes de terre', 'legumes-fruits', true, 800, 'g'),
    ('crème fraîche', 'produits-frais', false, 30, 'cl'),
    ('ail', 'legumes-fruits', true, 2, 'piece')
    ) as v(nom, categorie, fond, quantite, unite)
    join ingredient ing on ing.nom = v.nom and ing.categorie = v.categorie and ing.fond_de_placard = v.fond;
  insert into recette (nom, temps_preparation, vegetarien, accompagnement, saisons, etapes, user_id) values ('Cassoulet', 'long', false, 'feculents', array['hiver'], array['Faire revenir la saucisse et le lard.', 'Ajouter les haricots blancs et un peu d''eau.', 'Ajouter le confit de canard.', 'Laisser mijoter au four 1h30.'], null) returning id into rid;
  insert into recette_ingredient (recette_id, ingredient_id, quantite, unite)
    select rid, ing.id, v.quantite, v.unite from (values
    ('haricots blancs', 'epicerie', true, 500, 'g'),
    ('saucisse de Toulouse', 'viandes-poissons', false, 4, 'piece'),
    ('confit de canard', 'viandes-poissons', false, 2, 'piece'),
    ('lard fumé', 'viandes-poissons', false, 150, 'g')
    ) as v(nom, categorie, fond, quantite, unite)
    join ingredient ing on ing.nom = v.nom and ing.categorie = v.categorie and ing.fond_de_placard = v.fond;
  insert into recette (nom, temps_preparation, vegetarien, accompagnement, saisons, etapes, user_id) values ('Tourte à la viande', 'long', false, null, array['hiver'], array['Faire revenir le bœuf haché avec l''oignon.', 'Garnir un fond de pâte feuilletée.', 'Couvrir de la seconde pâte, souder les bords, dorer à l''œuf.', 'Cuire 35 min au four à 190°C.'], null) returning id into rid;
  insert into recette_ingredient (recette_id, ingredient_id, quantite, unite)
    select rid, ing.id, v.quantite, v.unite from (values
    ('pâte feuilletée', 'boulangerie', true, 2, 'piece'),
    ('bœuf haché', 'viandes-poissons', false, 400, 'g'),
    ('oignon', 'legumes-fruits', true, 1, 'piece'),
    ('œuf', 'produits-frais', false, 1, 'piece')
    ) as v(nom, categorie, fond, quantite, unite)
    join ingredient ing on ing.nom = v.nom and ing.categorie = v.categorie and ing.fond_de_placard = v.fond;
  insert into recette (nom, temps_preparation, vegetarien, accompagnement, saisons, etapes, user_id) values ('Tourte aux légumes et chèvre', 'long', true, null, array['automne'], array['Faire revenir les courgettes.', 'Garnir un fond de pâte, ajouter le chèvre émietté.', 'Couvrir de la seconde pâte, dorer à l''œuf.', 'Cuire 35 min au four à 190°C.'], null) returning id into rid;
  insert into recette_ingredient (recette_id, ingredient_id, quantite, unite)
    select rid, ing.id, v.quantite, v.unite from (values
    ('pâte feuilletée', 'boulangerie', true, 2, 'piece'),
    ('courgettes', 'legumes-fruits', false, 2, 'piece'),
    ('fromage de chèvre', 'produits-frais', false, 200, 'g'),
    ('œuf', 'produits-frais', false, 1, 'piece')
    ) as v(nom, categorie, fond, quantite, unite)
    join ingredient ing on ing.nom = v.nom and ing.categorie = v.categorie and ing.fond_de_placard = v.fond;
  insert into recette (nom, temps_preparation, vegetarien, accompagnement, saisons, etapes, user_id) values ('Risotto à la courge et parmesan', 'long', true, 'feculents', array['automne'], array['Couper et cuire la courge, réserver en purée grossière.', 'Nacrer le riz, mouiller progressivement de bouillon.', 'Ajouter la courge en fin de cuisson.', 'Terminer au parmesan.'], null) returning id into rid;
  insert into recette_ingredient (recette_id, ingredient_id, quantite, unite)
    select rid, ing.id, v.quantite, v.unite from (values
    ('riz à risotto', 'epicerie', true, 250, 'g'),
    ('courge butternut', 'legumes-fruits', false, 400, 'g'),
    ('bouillon de légumes', 'epicerie', true, 1, 'l'),
    ('parmesan', 'produits-frais', false, 50, 'g')
    ) as v(nom, categorie, fond, quantite, unite)
    join ingredient ing on ing.nom = v.nom and ing.categorie = v.categorie and ing.fond_de_placard = v.fond;
  insert into recette (nom, temps_preparation, vegetarien, accompagnement, saisons, etapes, user_id) values ('Curry d''agneau mijoté, riz', 'long', false, 'feculents', array['hiver'], array['Faire dorer les morceaux d''agneau.', 'Ajouter le curry en poudre puis le lait de coco.', 'Laisser mijoter 1h30 à couvert.', 'Servir avec le riz.'], null) returning id into rid;
  insert into recette_ingredient (recette_id, ingredient_id, quantite, unite)
    select rid, ing.id, v.quantite, v.unite from (values
    ('épaule d''agneau en morceaux', 'viandes-poissons', false, 500, 'g'),
    ('lait de coco', 'epicerie', true, 300, 'ml'),
    ('curry en poudre', 'epicerie', true, 1, 'cas'),
    ('riz basmati', 'epicerie', true, 200, 'g')
    ) as v(nom, categorie, fond, quantite, unite)
    join ingredient ing on ing.nom = v.nom and ing.categorie = v.categorie and ing.fond_de_placard = v.fond;
  insert into recette (nom, temps_preparation, vegetarien, accompagnement, saisons, etapes, user_id) values ('Blanquette de veau, riz', 'normal', false, 'feculents', array['hiver'], array['Faire blanchir le veau à l''eau bouillante.', 'Cuire avec carottes et champignons 40 min.', 'Lier la sauce à la crème.', 'Servir avec le riz.'], null) returning id into rid;
  insert into recette_ingredient (recette_id, ingredient_id, quantite, unite)
    select rid, ing.id, v.quantite, v.unite from (values
    ('veau à blanquette', 'viandes-poissons', false, 600, 'g'),
    ('carottes', 'legumes-fruits', true, 3, 'piece'),
    ('champignons de Paris', 'legumes-fruits', false, 200, 'g'),
    ('crème fraîche', 'produits-frais', false, 20, 'cl'),
    ('riz basmati', 'epicerie', true, 200, 'g')
    ) as v(nom, categorie, fond, quantite, unite)
    join ingredient ing on ing.nom = v.nom and ing.categorie = v.categorie and ing.fond_de_placard = v.fond;
  insert into recette (nom, temps_preparation, vegetarien, accompagnement, saisons, etapes, user_id) values ('Poulet au vin jaune et morilles', 'normal', false, 'feculents', array['automne'], array['Réhydrater les morilles.', 'Faire dorer le poulet.', 'Déglacer au vin jaune, ajouter morilles et crème.', 'Laisser mijoter 30 min.'], null) returning id into rid;
  insert into recette_ingredient (recette_id, ingredient_id, quantite, unite)
    select rid, ing.id, v.quantite, v.unite from (values
    ('cuisses de poulet', 'viandes-poissons', false, 4, 'piece'),
    ('morilles séchées', 'epicerie', true, 30, 'g'),
    ('vin jaune', 'epicerie', false, 100, 'ml'),
    ('crème fraîche', 'produits-frais', false, 20, 'cl')
    ) as v(nom, categorie, fond, quantite, unite)
    join ingredient ing on ing.nom = v.nom and ing.categorie = v.categorie and ing.fond_de_placard = v.fond;
  insert into recette (nom, temps_preparation, vegetarien, accompagnement, saisons, etapes, user_id) values ('Rôti de veau, gratin dauphinois', 'normal', false, 'feculents', null, array['Préparer le gratin dauphinois et enfourner 1h.', 'Saisir le rôti de veau.', 'Poursuivre sa cuisson au four.', 'Servir tranché avec le gratin.'], null) returning id into rid;
  insert into recette_ingredient (recette_id, ingredient_id, quantite, unite)
    select rid, ing.id, v.quantite, v.unite from (values
    ('rôti de veau', 'viandes-poissons', false, 800, 'g'),
    ('pommes de terre', 'legumes-fruits', true, 800, 'g'),
    ('crème fraîche', 'produits-frais', false, 30, 'cl'),
    ('ail', 'legumes-fruits', true, 2, 'piece')
    ) as v(nom, categorie, fond, quantite, unite)
    join ingredient ing on ing.nom = v.nom and ing.categorie = v.categorie and ing.fond_de_placard = v.fond;
  insert into recette (nom, temps_preparation, vegetarien, accompagnement, saisons, etapes, user_id) values ('Poule au riz', 'normal', false, 'feculents', array['hiver'], array['Cuire la poule avec les légumes dans un bouillon.', 'Cuire le riz dans une partie du bouillon.', 'Effilocher la poule.', 'Servir poule et riz ensemble.'], null) returning id into rid;
  insert into recette_ingredient (recette_id, ingredient_id, quantite, unite)
    select rid, ing.id, v.quantite, v.unite from (values
    ('poule', 'viandes-poissons', false, 1, 'piece'),
    ('riz basmati', 'epicerie', true, 250, 'g'),
    ('carottes', 'legumes-fruits', true, 2, 'piece'),
    ('oignon', 'legumes-fruits', true, 1, 'piece')
    ) as v(nom, categorie, fond, quantite, unite)
    join ingredient ing on ing.nom = v.nom and ing.categorie = v.categorie and ing.fond_de_placard = v.fond;
  insert into recette (nom, temps_preparation, vegetarien, accompagnement, saisons, etapes, user_id) values ('Navarin d''agneau printanier', 'normal', false, 'legumes', array['printemps'], array['Faire dorer l''agneau.', 'Ajouter les légumes et un peu d''eau.', 'Laisser mijoter 45 min.', 'Servir bien chaud.'], null) returning id into rid;
  insert into recette_ingredient (recette_id, ingredient_id, quantite, unite)
    select rid, ing.id, v.quantite, v.unite from (values
    ('agneau en morceaux', 'viandes-poissons', false, 600, 'g'),
    ('petits pois', 'surgeles', true, 200, 'g'),
    ('carottes nouvelles', 'legumes-fruits', false, 3, 'piece'),
    ('pommes de terre nouvelles', 'legumes-fruits', false, 400, 'g')
    ) as v(nom, categorie, fond, quantite, unite)
    join ingredient ing on ing.nom = v.nom and ing.categorie = v.categorie and ing.fond_de_placard = v.fond;
  insert into recette (nom, temps_preparation, vegetarien, accompagnement, saisons, etapes, user_id) values ('Fricassée de poulet aux morilles', 'normal', false, 'feculents', array['automne'], array['Réhydrater les morilles.', 'Faire dorer le poulet.', 'Déglacer au vin blanc, ajouter morilles et crème.', 'Laisser mijoter 25 min.'], null) returning id into rid;
  insert into recette_ingredient (recette_id, ingredient_id, quantite, unite)
    select rid, ing.id, v.quantite, v.unite from (values
    ('blanc de poulet', 'viandes-poissons', false, 4, 'piece'),
    ('morilles séchées', 'epicerie', true, 30, 'g'),
    ('crème fraîche', 'produits-frais', false, 20, 'cl'),
    ('vin blanc', 'epicerie', true, 100, 'ml')
    ) as v(nom, categorie, fond, quantite, unite)
    join ingredient ing on ing.nom = v.nom and ing.categorie = v.categorie and ing.fond_de_placard = v.fond;
  insert into recette (nom, temps_preparation, vegetarien, accompagnement, saisons, etapes, user_id) values ('Canard aux olives', 'normal', false, 'feculents', null, array['Faire dorer les cuisses de canard.', 'Ajouter l''oignon puis la sauce tomate.', 'Ajouter les olives.', 'Laisser mijoter 40 min.'], null) returning id into rid;
  insert into recette_ingredient (recette_id, ingredient_id, quantite, unite)
    select rid, ing.id, v.quantite, v.unite from (values
    ('cuisses de canard', 'viandes-poissons', false, 4, 'piece'),
    ('olives vertes', 'epicerie', false, 150, 'g'),
    ('sauce tomate', 'epicerie', true, 300, 'g'),
    ('oignon', 'legumes-fruits', true, 1, 'piece')
    ) as v(nom, categorie, fond, quantite, unite)
    join ingredient ing on ing.nom = v.nom and ing.categorie = v.categorie and ing.fond_de_placard = v.fond;
  insert into recette (nom, temps_preparation, vegetarien, accompagnement, saisons, etapes, user_id) values ('Lapin à la moutarde, tagliatelles', 'normal', false, 'feculents', null, array['Enduire le lapin de moutarde et le faire dorer.', 'Ajouter la crème, laisser mijoter 35 min.', 'Cuire les tagliatelles.', 'Servir ensemble.'], null) returning id into rid;
  insert into recette_ingredient (recette_id, ingredient_id, quantite, unite)
    select rid, ing.id, v.quantite, v.unite from (values
    ('lapin en morceaux', 'viandes-poissons', false, 800, 'g'),
    ('moutarde', 'epicerie', true, 3, 'cas'),
    ('crème fraîche', 'produits-frais', false, 20, 'cl'),
    ('tagliatelles', 'epicerie', true, 200, 'g')
    ) as v(nom, categorie, fond, quantite, unite)
    join ingredient ing on ing.nom = v.nom and ing.categorie = v.categorie and ing.fond_de_placard = v.fond;
  insert into recette (nom, temps_preparation, vegetarien, accompagnement, saisons, etapes, user_id) values ('Pot-au-feu', 'long', false, 'legumes', array['hiver'], array['Placer la viande dans une marmite d''eau froide, porter à ébullition.', 'Écumer puis ajouter les légumes.', 'Laisser mijoter 3h.', 'Servir bouillon, viande et légumes.'], null) returning id into rid;
  insert into recette_ingredient (recette_id, ingredient_id, quantite, unite)
    select rid, ing.id, v.quantite, v.unite from (values
    ('plat de côtes', 'viandes-poissons', false, 600, 'g'),
    ('carottes', 'legumes-fruits', true, 4, 'piece'),
    ('poireaux', 'legumes-fruits', false, 3, 'piece'),
    ('navets', 'legumes-fruits', false, 3, 'piece')
    ) as v(nom, categorie, fond, quantite, unite)
    join ingredient ing on ing.nom = v.nom and ing.categorie = v.categorie and ing.fond_de_placard = v.fond;
  insert into recette (nom, temps_preparation, vegetarien, accompagnement, saisons, etapes, user_id) values ('Bœuf bourguignon, pommes vapeur', 'long', false, 'feculents', array['hiver'], array['Faire dorer la viande et les lardons.', 'Mouiller au vin rouge, ajouter les champignons.', 'Laisser mijoter 2h30 à couvert.', 'Servir avec des pommes de terre vapeur.'], null) returning id into rid;
  insert into recette_ingredient (recette_id, ingredient_id, quantite, unite)
    select rid, ing.id, v.quantite, v.unite from (values
    ('bœuf à bourguignon', 'viandes-poissons', false, 800, 'g'),
    ('vin rouge', 'epicerie', true, 500, 'ml'),
    ('lardons', 'viandes-poissons', false, 150, 'g'),
    ('champignons de Paris', 'legumes-fruits', false, 250, 'g'),
    ('pommes de terre', 'legumes-fruits', true, 600, 'g')
    ) as v(nom, categorie, fond, quantite, unite)
    join ingredient ing on ing.nom = v.nom and ing.categorie = v.categorie and ing.fond_de_placard = v.fond;
  insert into recette (nom, temps_preparation, vegetarien, accompagnement, saisons, etapes, user_id) values ('Coq au vin', 'long', false, 'feculents', array['automne'], array['Faire dorer les morceaux de volaille et les lardons.', 'Mouiller au vin rouge, ajouter les champignons.', 'Laisser mijoter 1h30.', 'Servir nappé de sauce.'], null) returning id into rid;
  insert into recette_ingredient (recette_id, ingredient_id, quantite, unite)
    select rid, ing.id, v.quantite, v.unite from (values
    ('poulet fermier', 'viandes-poissons', false, 1, 'piece'),
    ('vin rouge', 'epicerie', true, 500, 'ml'),
    ('lardons', 'viandes-poissons', false, 150, 'g'),
    ('champignons de Paris', 'legumes-fruits', false, 250, 'g')
    ) as v(nom, categorie, fond, quantite, unite)
    join ingredient ing on ing.nom = v.nom and ing.categorie = v.categorie and ing.fond_de_placard = v.fond;
  insert into recette (nom, temps_preparation, vegetarien, accompagnement, saisons, etapes, user_id) values ('Blanquette de veau à l''ancienne', 'long', false, 'feculents', array['hiver'], array['Blanchir le veau puis le cuire avec un bouquet garni 1h30.', 'Ajouter carottes et champignons.', 'Lier la sauce avec la crème et un jaune d''œuf.', 'Servir avec le riz.'], null) returning id into rid;
  insert into recette_ingredient (recette_id, ingredient_id, quantite, unite)
    select rid, ing.id, v.quantite, v.unite from (values
    ('veau à blanquette', 'viandes-poissons', false, 800, 'g'),
    ('carottes', 'legumes-fruits', true, 4, 'piece'),
    ('champignons de Paris', 'legumes-fruits', false, 250, 'g'),
    ('crème fraîche', 'produits-frais', false, 25, 'cl'),
    ('riz basmati', 'epicerie', true, 200, 'g')
    ) as v(nom, categorie, fond, quantite, unite)
    join ingredient ing on ing.nom = v.nom and ing.categorie = v.categorie and ing.fond_de_placard = v.fond;
  insert into recette (nom, temps_preparation, vegetarien, accompagnement, saisons, etapes, user_id) values ('Daube provençale', 'long', false, 'legumes', array['automne'], array['Faire mariner la viande dans le vin rouge quelques heures.', 'Faire dorer puis mouiller de tomates concassées.', 'Ajouter les olives.', 'Laisser mijoter 3h à couvert.'], null) returning id into rid;
  insert into recette_ingredient (recette_id, ingredient_id, quantite, unite)
    select rid, ing.id, v.quantite, v.unite from (values
    ('bœuf à braiser', 'viandes-poissons', false, 800, 'g'),
    ('vin rouge', 'epicerie', true, 400, 'ml'),
    ('olives noires', 'epicerie', false, 100, 'g'),
    ('tomates concassées', 'epicerie', true, 400, 'g')
    ) as v(nom, categorie, fond, quantite, unite)
    join ingredient ing on ing.nom = v.nom and ing.categorie = v.categorie and ing.fond_de_placard = v.fond;
  insert into recette (nom, temps_preparation, vegetarien, accompagnement, saisons, etapes, user_id) values ('Civet de lapin', 'long', false, 'feculents', array['automne'], array['Faire mariner le lapin dans le vin rouge.', 'Faire dorer avec les lardons.', 'Mouiller de la marinade, ajouter les champignons.', 'Laisser mijoter 1h30.'], null) returning id into rid;
  insert into recette_ingredient (recette_id, ingredient_id, quantite, unite)
    select rid, ing.id, v.quantite, v.unite from (values
    ('lapin en morceaux', 'viandes-poissons', false, 1, 'piece'),
    ('vin rouge', 'epicerie', true, 400, 'ml'),
    ('lardons', 'viandes-poissons', false, 150, 'g'),
    ('champignons de Paris', 'legumes-fruits', false, 200, 'g')
    ) as v(nom, categorie, fond, quantite, unite)
    join ingredient ing on ing.nom = v.nom and ing.categorie = v.categorie and ing.fond_de_placard = v.fond;
  insert into recette (nom, temps_preparation, vegetarien, accompagnement, saisons, etapes, user_id) values ('Gigot d''agneau de Pâques, flageolets', 'long', false, 'feculents', array['printemps'], array['Piquer le gigot d''ail et de romarin.', 'Enfourner à four chaud selon le poids désiré.', 'Réchauffer les flageolets.', 'Servir le gigot tranché avec les flageolets.'], null) returning id into rid;
  insert into recette_ingredient (recette_id, ingredient_id, quantite, unite)
    select rid, ing.id, v.quantite, v.unite from (values
    ('gigot d''agneau', 'viandes-poissons', false, 1, 'piece'),
    ('flageolets', 'epicerie', true, 2, 'boite'),
    ('ail', 'legumes-fruits', true, 4, 'piece'),
    ('romarin', 'legumes-fruits', true, 1, 'piece')
    ) as v(nom, categorie, fond, quantite, unite)
    join ingredient ing on ing.nom = v.nom and ing.categorie = v.categorie and ing.fond_de_placard = v.fond;
  insert into recette (nom, temps_preparation, vegetarien, accompagnement, saisons, etapes, user_id) values ('Choucroute garnie', 'long', false, 'feculents', array['hiver'], array['Faire revenir la choucroute avec la poitrine fumée.', 'Mouiller et laisser mijoter 1h.', 'Ajouter les saucisses en fin de cuisson.', 'Servir avec les pommes de terre vapeur.'], null) returning id into rid;
  insert into recette_ingredient (recette_id, ingredient_id, quantite, unite)
    select rid, ing.id, v.quantite, v.unite from (values
    ('choucroute crue', 'legumes-fruits', false, 800, 'g'),
    ('saucisses fumées', 'viandes-poissons', false, 4, 'piece'),
    ('poitrine fumée', 'viandes-poissons', false, 200, 'g'),
    ('pommes de terre', 'legumes-fruits', true, 500, 'g')
    ) as v(nom, categorie, fond, quantite, unite)
    join ingredient ing on ing.nom = v.nom and ing.categorie = v.categorie and ing.fond_de_placard = v.fond;
  insert into recette (nom, temps_preparation, vegetarien, accompagnement, saisons, etapes, user_id) values ('Canard confit aux lentilles', 'long', false, 'feculents', array['hiver'], array['Cuire les lentilles avec carottes et oignon.', 'Faire dorer les cuisses de canard confites.', 'Réunir lentilles et canard.', 'Servir chaud.'], null) returning id into rid;
  insert into recette_ingredient (recette_id, ingredient_id, quantite, unite)
    select rid, ing.id, v.quantite, v.unite from (values
    ('cuisses de canard confites', 'viandes-poissons', false, 4, 'piece'),
    ('lentilles vertes', 'epicerie', true, 300, 'g'),
    ('carottes', 'legumes-fruits', true, 2, 'piece'),
    ('oignon', 'legumes-fruits', true, 1, 'piece')
    ) as v(nom, categorie, fond, quantite, unite)
    join ingredient ing on ing.nom = v.nom and ing.categorie = v.categorie and ing.fond_de_placard = v.fond;
  insert into recette (nom, temps_preparation, vegetarien, accompagnement, saisons, etapes, user_id) values ('Estouffade de bœuf aux carottes', 'long', false, 'legumes', array['hiver'], array['Faire dorer la viande et l''oignon.', 'Mouiller au vin rouge, ajouter les carottes.', 'Laisser mijoter 2h30 à couvert.', 'Servir bien chaud.'], null) returning id into rid;
  insert into recette_ingredient (recette_id, ingredient_id, quantite, unite)
    select rid, ing.id, v.quantite, v.unite from (values
    ('bœuf à braiser', 'viandes-poissons', false, 700, 'g'),
    ('carottes', 'legumes-fruits', true, 500, 'g'),
    ('vin rouge', 'epicerie', true, 300, 'ml'),
    ('oignon', 'legumes-fruits', true, 1, 'piece')
    ) as v(nom, categorie, fond, quantite, unite)
    join ingredient ing on ing.nom = v.nom and ing.categorie = v.categorie and ing.fond_de_placard = v.fond;
  insert into recette (nom, temps_preparation, vegetarien, accompagnement, saisons, etapes, user_id) values ('Tartiflette', 'long', true, 'feculents', array['hiver'], array['Cuire les pommes de terre en rondelles.', 'Faire revenir l''oignon.', 'Disposer pommes de terre, oignon et crème dans un plat, couvrir de reblochon coupé en deux.', 'Gratiner au four 25 min.'], null) returning id into rid;
  insert into recette_ingredient (recette_id, ingredient_id, quantite, unite)
    select rid, ing.id, v.quantite, v.unite from (values
    ('pommes de terre', 'legumes-fruits', true, 800, 'g'),
    ('reblochon', 'produits-frais', false, 1, 'piece'),
    ('oignon', 'legumes-fruits', true, 1, 'piece'),
    ('crème fraîche', 'produits-frais', false, 10, 'cl')
    ) as v(nom, categorie, fond, quantite, unite)
    join ingredient ing on ing.nom = v.nom and ing.categorie = v.categorie and ing.fond_de_placard = v.fond;
  insert into recette (nom, temps_preparation, vegetarien, accompagnement, saisons, etapes, user_id) values ('Gratin de macaronis à l''ancienne, jambon', 'long', false, 'feculents', array['hiver'], array['Cuire les macaronis.', 'Mélanger avec le jambon et la béchamel.', 'Verser dans un plat, couvrir de fromage.', 'Gratiner au four 30 min.'], null) returning id into rid;
  insert into recette_ingredient (recette_id, ingredient_id, quantite, unite)
    select rid, ing.id, v.quantite, v.unite from (values
    ('macaronis', 'epicerie', true, 300, 'g'),
    ('jambon', 'viandes-poissons', false, 200, 'g'),
    ('béchamel', 'epicerie', false, 500, 'ml'),
    ('fromage râpé', 'produits-frais', false, 100, 'g')
    ) as v(nom, categorie, fond, quantite, unite)
    join ingredient ing on ing.nom = v.nom and ing.categorie = v.categorie and ing.fond_de_placard = v.fond;
  insert into recette (nom, temps_preparation, vegetarien, accompagnement, saisons, etapes, user_id) values ('Poule au pot de grand-mère, légumes', 'long', false, 'legumes', array['hiver'], array['Cuire la poule à petit bouillon avec les légumes 2h30.', 'Écumer régulièrement.', 'Découper la poule.', 'Servir avec les légumes et un peu de bouillon.'], null) returning id into rid;
  insert into recette_ingredient (recette_id, ingredient_id, quantite, unite)
    select rid, ing.id, v.quantite, v.unite from (values
    ('poule', 'viandes-poissons', false, 1, 'piece'),
    ('carottes', 'legumes-fruits', true, 4, 'piece'),
    ('navets', 'legumes-fruits', false, 3, 'piece'),
    ('poireaux', 'legumes-fruits', false, 3, 'piece')
    ) as v(nom, categorie, fond, quantite, unite)
    join ingredient ing on ing.nom = v.nom and ing.categorie = v.categorie and ing.fond_de_placard = v.fond;
  insert into recette (nom, temps_preparation, vegetarien, accompagnement, saisons, etapes, user_id) values ('Ragoût de mouton aux pommes de terre', 'long', false, 'feculents', array['hiver'], array['Faire dorer la viande et l''oignon.', 'Ajouter les pommes de terre et le bouquet garni.', 'Mouiller à hauteur.', 'Laisser mijoter 2h.'], null) returning id into rid;
  insert into recette_ingredient (recette_id, ingredient_id, quantite, unite)
    select rid, ing.id, v.quantite, v.unite from (values
    ('mouton en morceaux', 'viandes-poissons', false, 700, 'g'),
    ('pommes de terre', 'legumes-fruits', true, 600, 'g'),
    ('oignon', 'legumes-fruits', true, 1, 'piece'),
    ('bouquet garni', 'legumes-fruits', true, 1, 'piece')
    ) as v(nom, categorie, fond, quantite, unite)
    join ingredient ing on ing.nom = v.nom and ing.categorie = v.categorie and ing.fond_de_placard = v.fond;
  insert into recette (nom, temps_preparation, vegetarien, accompagnement, saisons, etapes, user_id) values ('Veau Marengo', 'long', false, 'feculents', array['automne'], array['Faire dorer le veau.', 'Déglacer au vin blanc, ajouter les tomates.', 'Ajouter les champignons.', 'Laisser mijoter 1h30.'], null) returning id into rid;
  insert into recette_ingredient (recette_id, ingredient_id, quantite, unite)
    select rid, ing.id, v.quantite, v.unite from (values
    ('veau en morceaux', 'viandes-poissons', false, 700, 'g'),
    ('tomates concassées', 'epicerie', true, 400, 'g'),
    ('champignons de Paris', 'legumes-fruits', false, 200, 'g'),
    ('vin blanc', 'epicerie', true, 150, 'ml')
    ) as v(nom, categorie, fond, quantite, unite)
    join ingredient ing on ing.nom = v.nom and ing.categorie = v.categorie and ing.fond_de_placard = v.fond;
  insert into recette (nom, temps_preparation, vegetarien, accompagnement, saisons, etapes, user_id) values ('Ratatouille mijotée et rôti d''agneau', 'long', false, 'legumes', array['ete'], array['Préparer la ratatouille en faisant mijoter les légumes 45 min.', 'Saisir puis rôtir l''agneau au four.', 'Laisser reposer la viande.', 'Servir tranché avec la ratatouille.'], null) returning id into rid;
  insert into recette_ingredient (recette_id, ingredient_id, quantite, unite)
    select rid, ing.id, v.quantite, v.unite from (values
    ('rôti d''agneau', 'viandes-poissons', false, 800, 'g'),
    ('courgettes', 'legumes-fruits', false, 2, 'piece'),
    ('aubergine', 'legumes-fruits', false, 1, 'piece'),
    ('tomates', 'legumes-fruits', false, 4, 'piece')
    ) as v(nom, categorie, fond, quantite, unite)
    join ingredient ing on ing.nom = v.nom and ing.categorie = v.categorie and ing.fond_de_placard = v.fond;
  insert into recette (nom, temps_preparation, vegetarien, accompagnement, saisons, etapes, user_id) values ('Tarte aux légumes d''antan, salade verte', 'long', true, 'legumes', array['automne'], array['Faire revenir la courge et l''oignon.', 'Garnir le fond de pâte, couvrir de fromage.', 'Cuire 35 min au four à 180°C.', 'Servir avec la salade verte.'], null) returning id into rid;
  insert into recette_ingredient (recette_id, ingredient_id, quantite, unite)
    select rid, ing.id, v.quantite, v.unite from (values
    ('pâte brisée', 'boulangerie', true, 1, 'piece'),
    ('courge butternut', 'legumes-fruits', false, 300, 'g'),
    ('oignon', 'legumes-fruits', true, 1, 'piece'),
    ('fromage râpé', 'produits-frais', false, 80, 'g'),
    ('salade verte', 'legumes-fruits', false, 1, 'piece')
    ) as v(nom, categorie, fond, quantite, unite)
    join ingredient ing on ing.nom = v.nom and ing.categorie = v.categorie and ing.fond_de_placard = v.fond;
  insert into recette (nom, temps_preparation, vegetarien, accompagnement, saisons, etapes, user_id) values ('Raclette', 'normal', false, 'feculents', array['hiver'], array['Cuire les pommes de terre à l''eau ou à la vapeur.', 'Disposer charcuterie et cornichons sur la table.', 'Faire fondre les tranches de fromage à l''appareil à raclette.', 'Napper les pommes de terre de fromage fondu.'], null) returning id into rid;
  insert into recette_ingredient (recette_id, ingredient_id, quantite, unite)
    select rid, ing.id, v.quantite, v.unite from (values
    ('fromage à raclette', 'produits-frais', false, 800, 'g'),
    ('pommes de terre', 'legumes-fruits', true, 1, 'kg'),
    ('charcuterie assortie', 'viandes-poissons', false, 400, 'g'),
    ('cornichons', 'epicerie', true, 1, 'boite')
    ) as v(nom, categorie, fond, quantite, unite)
    join ingredient ing on ing.nom = v.nom and ing.categorie = v.categorie and ing.fond_de_placard = v.fond;
  insert into recette (nom, temps_preparation, vegetarien, accompagnement, saisons, etapes, user_id) values ('Truffade auvergnate', 'normal', true, 'legumes', array['hiver'], array['Couper les pommes de terre en lamelles et les cuire à la poêle.', 'Ajouter l''ail écrasé.', 'Incorporer la tome fraîche coupée en morceaux, mélanger jusqu''à filage.', 'Servir avec la salade verte.'], null) returning id into rid;
  insert into recette_ingredient (recette_id, ingredient_id, quantite, unite)
    select rid, ing.id, v.quantite, v.unite from (values
    ('pommes de terre', 'legumes-fruits', true, 800, 'g'),
    ('tome fraîche de Cantal', 'produits-frais', false, 500, 'g'),
    ('ail', 'legumes-fruits', true, 2, 'piece'),
    ('salade verte', 'legumes-fruits', false, 1, 'piece')
    ) as v(nom, categorie, fond, quantite, unite)
    join ingredient ing on ing.nom = v.nom and ing.categorie = v.categorie and ing.fond_de_placard = v.fond;
  insert into recette (nom, temps_preparation, vegetarien, accompagnement, saisons, etapes, user_id) values ('Mont d''or au four, pommes vapeur', 'normal', true, 'feculents', array['hiver'], array['Inciser le dessus du mont d''or, glisser l''ail et le vin blanc.', 'Enfourner la boîte cerclée 20 min à 180°C.', 'Cuire les pommes de terre à la vapeur.', 'Tremper les pommes de terre dans le fromage fondu.'], null) returning id into rid;
  insert into recette_ingredient (recette_id, ingredient_id, quantite, unite)
    select rid, ing.id, v.quantite, v.unite from (values
    ('mont d''or', 'produits-frais', false, 1, 'piece'),
    ('ail', 'legumes-fruits', true, 1, 'piece'),
    ('vin blanc', 'epicerie', true, 2, 'cas'),
    ('pommes de terre', 'legumes-fruits', true, 600, 'g')
    ) as v(nom, categorie, fond, quantite, unite)
    join ingredient ing on ing.nom = v.nom and ing.categorie = v.categorie and ing.fond_de_placard = v.fond;
  insert into recette (nom, temps_preparation, vegetarien, accompagnement, saisons, etapes, user_id) values ('Fondue savoyarde', 'rapide', true, 'legumes', array['hiver'], array['Frotter le caquelon à l''ail.', 'Faire fondre les fromages râpés avec le vin blanc.', 'Mélanger jusqu''à consistance lisse.', 'Servir avec des cubes de pain à tremper.'], null) returning id into rid;
  insert into recette_ingredient (recette_id, ingredient_id, quantite, unite)
    select rid, ing.id, v.quantite, v.unite from (values
    ('comté', 'produits-frais', false, 200, 'g'),
    ('beaufort', 'produits-frais', false, 200, 'g'),
    ('vin blanc', 'epicerie', true, 200, 'ml'),
    ('pain de campagne', 'boulangerie', true, 1, 'piece')
    ) as v(nom, categorie, fond, quantite, unite)
    join ingredient ing on ing.nom = v.nom and ing.categorie = v.categorie and ing.fond_de_placard = v.fond;
  insert into recette (nom, temps_preparation, vegetarien, accompagnement, saisons, etapes, user_id) values ('Nouilles sautées au poulet et légumes', 'rapide', false, 'legumes', null, array['Cuire les nouilles.', 'Faire sauter le poulet coupé en lamelles.', 'Ajouter les poivrons émincés.', 'Ajouter les nouilles et la sauce soja, sauter le tout.'], null) returning id into rid;
  insert into recette_ingredient (recette_id, ingredient_id, quantite, unite)
    select rid, ing.id, v.quantite, v.unite from (values
    ('nouilles chinoises', 'epicerie', true, 200, 'g'),
    ('blanc de poulet', 'viandes-poissons', false, 2, 'piece'),
    ('poivrons', 'legumes-fruits', false, 1, 'piece'),
    ('sauce soja', 'epicerie', true, 2, 'cas')
    ) as v(nom, categorie, fond, quantite, unite)
    join ingredient ing on ing.nom = v.nom and ing.categorie = v.categorie and ing.fond_de_placard = v.fond;
  insert into recette (nom, temps_preparation, vegetarien, accompagnement, saisons, etapes, user_id) values ('Nouilles sautées aux légumes et tofu', 'rapide', true, 'legumes', null, array['Cuire les nouilles.', 'Faire dorer le tofu coupé en cubes.', 'Ajouter les poivrons émincés.', 'Ajouter les nouilles et la sauce soja, sauter le tout.'], null) returning id into rid;
  insert into recette_ingredient (recette_id, ingredient_id, quantite, unite)
    select rid, ing.id, v.quantite, v.unite from (values
    ('nouilles chinoises', 'epicerie', true, 200, 'g'),
    ('tofu ferme', 'produits-frais', false, 250, 'g'),
    ('poivrons', 'legumes-fruits', false, 1, 'piece'),
    ('sauce soja', 'epicerie', true, 2, 'cas')
    ) as v(nom, categorie, fond, quantite, unite)
    join ingredient ing on ing.nom = v.nom and ing.categorie = v.categorie and ing.fond_de_placard = v.fond;
  insert into recette (nom, temps_preparation, vegetarien, accompagnement, saisons, etapes, user_id) values ('Tacos au bœuf épicé', 'rapide', false, 'legumes', null, array['Faire revenir le bœuf haché avec les épices.', 'Réchauffer les tortillas.', 'Garnir de viande, salade et tomates.', 'Servir aussitôt.'], null) returning id into rid;
  insert into recette_ingredient (recette_id, ingredient_id, quantite, unite)
    select rid, ing.id, v.quantite, v.unite from (values
    ('tortillas de maïs', 'boulangerie', true, 6, 'piece'),
    ('bœuf haché', 'viandes-poissons', false, 300, 'g'),
    ('épices à tacos', 'epicerie', true, 1, 'sachet'),
    ('salade verte', 'legumes-fruits', false, 1, 'piece'),
    ('tomates', 'legumes-fruits', false, 2, 'piece')
    ) as v(nom, categorie, fond, quantite, unite)
    join ingredient ing on ing.nom = v.nom and ing.categorie = v.categorie and ing.fond_de_placard = v.fond;
  insert into recette (nom, temps_preparation, vegetarien, accompagnement, saisons, etapes, user_id) values ('Wok de crevettes à l''asiatique, riz', 'rapide', false, 'feculents', null, array['Cuire le riz.', 'Faire sauter les poivrons et le gingembre.', 'Ajouter les crevettes et la sauce soja.', 'Servir avec le riz.'], null) returning id into rid;
  insert into recette_ingredient (recette_id, ingredient_id, quantite, unite)
    select rid, ing.id, v.quantite, v.unite from (values
    ('crevettes décortiquées', 'surgeles', true, 300, 'g'),
    ('poivrons', 'legumes-fruits', false, 1, 'piece'),
    ('gingembre', 'legumes-fruits', true, 1, 'piece'),
    ('sauce soja', 'epicerie', true, 2, 'cas'),
    ('riz basmati', 'epicerie', true, 150, 'g')
    ) as v(nom, categorie, fond, quantite, unite)
    join ingredient ing on ing.nom = v.nom and ing.categorie = v.categorie and ing.fond_de_placard = v.fond;
  insert into recette (nom, temps_preparation, vegetarien, accompagnement, saisons, etapes, user_id) values ('Falafels wrap à la libanaise', 'rapide', true, 'legumes', null, array['Cuire les falafels.', 'Garnir les tortillas de concombre et falafels.', 'Napper de sauce au yaourt.', 'Rouler et servir.'], null) returning id into rid;
  insert into recette_ingredient (recette_id, ingredient_id, quantite, unite)
    select rid, ing.id, v.quantite, v.unite from (values
    ('falafels', 'surgeles', false, 12, 'piece'),
    ('tortillas de blé', 'boulangerie', true, 4, 'piece'),
    ('concombre', 'legumes-fruits', false, 1, 'piece'),
    ('sauce au yaourt', 'produits-frais', false, 100, 'g')
    ) as v(nom, categorie, fond, quantite, unite)
    join ingredient ing on ing.nom = v.nom and ing.categorie = v.categorie and ing.fond_de_placard = v.fond;
  insert into recette (nom, temps_preparation, vegetarien, accompagnement, saisons, etapes, user_id) values ('Chili con carne, riz', 'normal', false, 'feculents', array['automne'], array['Faire revenir le bœuf haché.', 'Ajouter les tomates concassées et le piment.', 'Ajouter les haricots rouges, laisser mijoter 25 min.', 'Servir avec le riz.'], null) returning id into rid;
  insert into recette_ingredient (recette_id, ingredient_id, quantite, unite)
    select rid, ing.id, v.quantite, v.unite from (values
    ('bœuf haché', 'viandes-poissons', false, 400, 'g'),
    ('haricots rouges', 'epicerie', true, 1, 'boite'),
    ('tomates concassées', 'epicerie', true, 400, 'g'),
    ('piment en poudre', 'epicerie', true, 1, 'cac'),
    ('riz basmati', 'epicerie', true, 200, 'g')
    ) as v(nom, categorie, fond, quantite, unite)
    join ingredient ing on ing.nom = v.nom and ing.categorie = v.categorie and ing.fond_de_placard = v.fond;
  insert into recette (nom, temps_preparation, vegetarien, accompagnement, saisons, etapes, user_id) values ('Chili sin carne végétarien, riz', 'normal', true, 'feculents', array['automne'], array['Faire revenir les tomates concassées et le piment.', 'Ajouter haricots rouges et maïs.', 'Laisser mijoter 20 min.', 'Servir avec le riz.'], null) returning id into rid;
  insert into recette_ingredient (recette_id, ingredient_id, quantite, unite)
    select rid, ing.id, v.quantite, v.unite from (values
    ('haricots rouges', 'epicerie', true, 2, 'boite'),
    ('maïs', 'epicerie', true, 1, 'boite'),
    ('tomates concassées', 'epicerie', true, 400, 'g'),
    ('piment en poudre', 'epicerie', true, 1, 'cac'),
    ('riz basmati', 'epicerie', true, 200, 'g')
    ) as v(nom, categorie, fond, quantite, unite)
    join ingredient ing on ing.nom = v.nom and ing.categorie = v.categorie and ing.fond_de_placard = v.fond;
  insert into recette (nom, temps_preparation, vegetarien, accompagnement, saisons, etapes, user_id) values ('Curry indien végétarien, riz basmati', 'normal', true, 'feculents', null, array['Faire revenir le curry en poudre.', 'Ajouter le lait de coco et les pois chiches.', 'Ajouter les épinards en fin de cuisson.', 'Servir avec le riz basmati.'], null) returning id into rid;
  insert into recette_ingredient (recette_id, ingredient_id, quantite, unite)
    select rid, ing.id, v.quantite, v.unite from (values
    ('pois chiches cuits', 'epicerie', true, 400, 'g'),
    ('épinards', 'legumes-fruits', false, 200, 'g'),
    ('lait de coco', 'epicerie', true, 300, 'ml'),
    ('curry en poudre', 'epicerie', true, 1, 'cas'),
    ('riz basmati', 'epicerie', true, 200, 'g')
    ) as v(nom, categorie, fond, quantite, unite)
    join ingredient ing on ing.nom = v.nom and ing.categorie = v.categorie and ing.fond_de_placard = v.fond;
  insert into recette (nom, temps_preparation, vegetarien, accompagnement, saisons, etapes, user_id) values ('Curry de poulet à l''indienne (tikka masala), riz', 'normal', false, 'feculents', null, array['Faire mariner puis dorer le poulet.', 'Ajouter la sauce tomate et le garam masala.', 'Ajouter la crème, laisser mijoter 15 min.', 'Servir avec le riz basmati.'], null) returning id into rid;
  insert into recette_ingredient (recette_id, ingredient_id, quantite, unite)
    select rid, ing.id, v.quantite, v.unite from (values
    ('blanc de poulet', 'viandes-poissons', false, 400, 'g'),
    ('sauce tomate', 'epicerie', true, 300, 'g'),
    ('crème fraîche', 'produits-frais', false, 15, 'cl'),
    ('garam masala', 'epicerie', true, 1, 'cas'),
    ('riz basmati', 'epicerie', true, 200, 'g')
    ) as v(nom, categorie, fond, quantite, unite)
    join ingredient ing on ing.nom = v.nom and ing.categorie = v.categorie and ing.fond_de_placard = v.fond;
  insert into recette (nom, temps_preparation, vegetarien, accompagnement, saisons, etapes, user_id) values ('Poulet tandoori, riz basmati', 'normal', false, 'feculents', null, array['Faire mariner le poulet dans le yaourt et les épices.', 'Cuire au four ou à la poêle.', 'Cuire le riz basmati.', 'Servir ensemble.'], null) returning id into rid;
  insert into recette_ingredient (recette_id, ingredient_id, quantite, unite)
    select rid, ing.id, v.quantite, v.unite from (values
    ('blanc de poulet', 'viandes-poissons', false, 4, 'piece'),
    ('yaourt nature', 'produits-frais', false, 100, 'g'),
    ('épices tandoori', 'epicerie', true, 1, 'cas'),
    ('riz basmati', 'epicerie', true, 200, 'g')
    ) as v(nom, categorie, fond, quantite, unite)
    join ingredient ing on ing.nom = v.nom and ing.categorie = v.categorie and ing.fond_de_placard = v.fond;
  insert into recette (nom, temps_preparation, vegetarien, accompagnement, saisons, etapes, user_id) values ('Bœuf sauté à la thaï, riz', 'normal', false, 'feculents', null, array['Cuire le riz.', 'Faire sauter le bœuf à feu vif.', 'Ajouter la sauce nuoc-mâm et le basilic thaï.', 'Servir avec le riz.'], null) returning id into rid;
  insert into recette_ingredient (recette_id, ingredient_id, quantite, unite)
    select rid, ing.id, v.quantite, v.unite from (values
    ('bœuf en lanières', 'viandes-poissons', false, 300, 'g'),
    ('basilic thaï', 'legumes-fruits', false, 1, 'piece'),
    ('sauce nuoc-mâm', 'epicerie', true, 2, 'cas'),
    ('riz basmati', 'epicerie', true, 200, 'g')
    ) as v(nom, categorie, fond, quantite, unite)
    join ingredient ing on ing.nom = v.nom and ing.categorie = v.categorie and ing.fond_de_placard = v.fond;
  insert into recette (nom, temps_preparation, vegetarien, accompagnement, saisons, etapes, user_id) values ('Pad thaï aux crevettes', 'normal', false, 'feculents', null, array['Faire tremper les nouilles de riz dans l''eau chaude.', 'Faire sauter les crevettes puis pousser sur le côté, brouiller l''œuf.', 'Ajouter les nouilles et la sauce nuoc-mâm.', 'Parsemer de cacahuètes concassées.'], null) returning id into rid;
  insert into recette_ingredient (recette_id, ingredient_id, quantite, unite)
    select rid, ing.id, v.quantite, v.unite from (values
    ('nouilles de riz', 'epicerie', true, 200, 'g'),
    ('crevettes décortiquées', 'surgeles', true, 250, 'g'),
    ('œufs', 'produits-frais', false, 2, 'piece'),
    ('cacahuètes', 'epicerie', true, 30, 'g'),
    ('sauce nuoc-mâm', 'epicerie', true, 2, 'cas')
    ) as v(nom, categorie, fond, quantite, unite)
    join ingredient ing on ing.nom = v.nom and ing.categorie = v.categorie and ing.fond_de_placard = v.fond;
  insert into recette (nom, temps_preparation, vegetarien, accompagnement, saisons, etapes, user_id) values ('Fajitas au poulet', 'normal', false, 'legumes', null, array['Couper le poulet et les poivrons en lanières.', 'Faire sauter avec les épices à fajitas.', 'Réchauffer les tortillas.', 'Garnir et rouler les fajitas.'], null) returning id into rid;
  insert into recette_ingredient (recette_id, ingredient_id, quantite, unite)
    select rid, ing.id, v.quantite, v.unite from (values
    ('tortillas de blé', 'boulangerie', true, 6, 'piece'),
    ('blanc de poulet', 'viandes-poissons', false, 2, 'piece'),
    ('poivrons', 'legumes-fruits', false, 2, 'piece'),
    ('épices à fajitas', 'epicerie', true, 1, 'sachet')
    ) as v(nom, categorie, fond, quantite, unite)
    join ingredient ing on ing.nom = v.nom and ing.categorie = v.categorie and ing.fond_de_placard = v.fond;
  insert into recette (nom, temps_preparation, vegetarien, accompagnement, saisons, etapes, user_id) values ('Fajitas végétariennes', 'normal', true, 'legumes', null, array['Faire sauter les poivrons avec les épices à fajitas.', 'Ajouter les haricots rouges.', 'Réchauffer les tortillas.', 'Garnir et rouler les fajitas.'], null) returning id into rid;
  insert into recette_ingredient (recette_id, ingredient_id, quantite, unite)
    select rid, ing.id, v.quantite, v.unite from (values
    ('tortillas de blé', 'boulangerie', true, 6, 'piece'),
    ('poivrons', 'legumes-fruits', false, 3, 'piece'),
    ('haricots rouges', 'epicerie', true, 1, 'boite'),
    ('épices à fajitas', 'epicerie', true, 1, 'sachet')
    ) as v(nom, categorie, fond, quantite, unite)
    join ingredient ing on ing.nom = v.nom and ing.categorie = v.categorie and ing.fond_de_placard = v.fond;
  insert into recette (nom, temps_preparation, vegetarien, accompagnement, saisons, etapes, user_id) values ('Dhal de lentilles corail', 'normal', true, 'feculents', null, array['Faire revenir l''oignon avec le curry.', 'Ajouter les lentilles et le lait de coco.', 'Laisser mijoter 25 min.', 'Servir avec le riz.'], null) returning id into rid;
  insert into recette_ingredient (recette_id, ingredient_id, quantite, unite)
    select rid, ing.id, v.quantite, v.unite from (values
    ('lentilles corail', 'epicerie', true, 250, 'g'),
    ('lait de coco', 'epicerie', true, 300, 'ml'),
    ('curry en poudre', 'epicerie', true, 1, 'cas'),
    ('oignon', 'legumes-fruits', true, 1, 'piece'),
    ('riz basmati', 'epicerie', true, 150, 'g')
    ) as v(nom, categorie, fond, quantite, unite)
    join ingredient ing on ing.nom = v.nom and ing.categorie = v.categorie and ing.fond_de_placard = v.fond;
  insert into recette (nom, temps_preparation, vegetarien, accompagnement, saisons, etapes, user_id) values ('Poulet au curry japonais (kare raisu), riz', 'normal', false, 'feculents', null, array['Faire revenir le poulet et les carottes.', 'Mouiller à hauteur et laisser mijoter 15 min.', 'Ajouter le bloc de curry et laisser épaissir.', 'Servir sur le riz.'], null) returning id into rid;
  insert into recette_ingredient (recette_id, ingredient_id, quantite, unite)
    select rid, ing.id, v.quantite, v.unite from (values
    ('blanc de poulet', 'viandes-poissons', false, 400, 'g'),
    ('carottes', 'legumes-fruits', true, 2, 'piece'),
    ('bloc de curry japonais', 'epicerie', true, 100, 'g'),
    ('riz basmati', 'epicerie', true, 200, 'g')
    ) as v(nom, categorie, fond, quantite, unite)
    join ingredient ing on ing.nom = v.nom and ing.categorie = v.categorie and ing.fond_de_placard = v.fond;
  insert into recette (nom, temps_preparation, vegetarien, accompagnement, saisons, etapes, user_id) values ('Ramen au porc et œuf mollet', 'normal', false, 'feculents', array['hiver'], array['Préparer le bouillon dashi.', 'Cuire les nouilles ramen.', 'Poêler la poitrine de porc en tranches.', 'Dresser avec le bouillon, le porc et l''œuf mollet.'], null) returning id into rid;
  insert into recette_ingredient (recette_id, ingredient_id, quantite, unite)
    select rid, ing.id, v.quantite, v.unite from (values
    ('nouilles ramen', 'epicerie', true, 200, 'g'),
    ('poitrine de porc', 'viandes-poissons', false, 200, 'g'),
    ('œufs', 'produits-frais', false, 2, 'piece'),
    ('bouillon dashi', 'epicerie', true, 1, 'l')
    ) as v(nom, categorie, fond, quantite, unite)
    join ingredient ing on ing.nom = v.nom and ing.categorie = v.categorie and ing.fond_de_placard = v.fond;
  insert into recette (nom, temps_preparation, vegetarien, accompagnement, saisons, etapes, user_id) values ('Ramen végétarien aux champignons', 'normal', true, 'feculents', array['hiver'], array['Préparer le bouillon de légumes.', 'Cuire les nouilles ramen.', 'Faire sauter les champignons.', 'Dresser avec le bouillon, les champignons et l''œuf mollet.'], null) returning id into rid;
  insert into recette_ingredient (recette_id, ingredient_id, quantite, unite)
    select rid, ing.id, v.quantite, v.unite from (values
    ('nouilles ramen', 'epicerie', true, 200, 'g'),
    ('champignons shiitake', 'legumes-fruits', false, 150, 'g'),
    ('œufs', 'produits-frais', false, 2, 'piece'),
    ('bouillon de légumes', 'epicerie', true, 1, 'l')
    ) as v(nom, categorie, fond, quantite, unite)
    join ingredient ing on ing.nom = v.nom and ing.categorie = v.categorie and ing.fond_de_placard = v.fond;
  insert into recette (nom, temps_preparation, vegetarien, accompagnement, saisons, etapes, user_id) values ('Empanadillas à la viande, salade', 'long', false, 'legumes', null, array['Faire revenir le bœuf haché avec l''oignon et les olives.', 'Garnir les disques de pâte et refermer en chausson.', 'Cuire au four 20 min à 200°C.', 'Servir avec la salade verte.'], null) returning id into rid;
  insert into recette_ingredient (recette_id, ingredient_id, quantite, unite)
    select rid, ing.id, v.quantite, v.unite from (values
    ('pâte à empanadas', 'boulangerie', true, 12, 'piece'),
    ('bœuf haché', 'viandes-poissons', false, 300, 'g'),
    ('oignon', 'legumes-fruits', true, 1, 'piece'),
    ('olives vertes', 'epicerie', false, 50, 'g'),
    ('salade verte', 'legumes-fruits', false, 1, 'piece')
    ) as v(nom, categorie, fond, quantite, unite)
    join ingredient ing on ing.nom = v.nom and ing.categorie = v.categorie and ing.fond_de_placard = v.fond;
  insert into recette (nom, temps_preparation, vegetarien, accompagnement, saisons, etapes, user_id) values ('Empanadillas aux légumes et fromage', 'long', true, 'legumes', null, array['Faire revenir poivrons et épinards.', 'Ajouter le fromage râpé, garnir les disques de pâte.', 'Refermer en chausson.', 'Cuire au four 20 min à 200°C.'], null) returning id into rid;
  insert into recette_ingredient (recette_id, ingredient_id, quantite, unite)
    select rid, ing.id, v.quantite, v.unite from (values
    ('pâte à empanadas', 'boulangerie', true, 12, 'piece'),
    ('poivrons', 'legumes-fruits', false, 2, 'piece'),
    ('épinards', 'legumes-fruits', false, 150, 'g'),
    ('fromage râpé', 'produits-frais', false, 100, 'g')
    ) as v(nom, categorie, fond, quantite, unite)
    join ingredient ing on ing.nom = v.nom and ing.categorie = v.categorie and ing.fond_de_placard = v.fond;
  insert into recette (nom, temps_preparation, vegetarien, accompagnement, saisons, etapes, user_id) values ('Tajine d''agneau aux pruneaux, semoule', 'long', false, 'feculents', array['automne'], array['Faire dorer l''agneau avec l''oignon et les épices.', 'Ajouter les pruneaux et un peu d''eau.', 'Laisser mijoter 1h30 à couvert.', 'Servir avec la semoule.'], null) returning id into rid;
  insert into recette_ingredient (recette_id, ingredient_id, quantite, unite)
    select rid, ing.id, v.quantite, v.unite from (values
    ('épaule d''agneau', 'viandes-poissons', false, 600, 'g'),
    ('pruneaux', 'epicerie', true, 150, 'g'),
    ('oignon', 'legumes-fruits', true, 1, 'piece'),
    ('épices à tajine', 'epicerie', true, 1, 'cas'),
    ('semoule', 'epicerie', true, 200, 'g')
    ) as v(nom, categorie, fond, quantite, unite)
    join ingredient ing on ing.nom = v.nom and ing.categorie = v.categorie and ing.fond_de_placard = v.fond;
  insert into recette (nom, temps_preparation, vegetarien, accompagnement, saisons, etapes, user_id) values ('Tajine de légumes et pois chiches', 'long', true, 'feculents', array['automne'], array['Faire revenir les légumes avec les épices.', 'Ajouter les pois chiches et un peu d''eau.', 'Laisser mijoter 45 min à couvert.', 'Servir avec la semoule.'], null) returning id into rid;
  insert into recette_ingredient (recette_id, ingredient_id, quantite, unite)
    select rid, ing.id, v.quantite, v.unite from (values
    ('courgettes', 'legumes-fruits', false, 2, 'piece'),
    ('carottes', 'legumes-fruits', true, 2, 'piece'),
    ('pois chiches cuits', 'epicerie', true, 400, 'g'),
    ('épices à tajine', 'epicerie', true, 1, 'cas'),
    ('semoule', 'epicerie', true, 200, 'g')
    ) as v(nom, categorie, fond, quantite, unite)
    join ingredient ing on ing.nom = v.nom and ing.categorie = v.categorie and ing.fond_de_placard = v.fond;
  insert into recette (nom, temps_preparation, vegetarien, accompagnement, saisons, etapes, user_id) values ('Goulasch hongrois, pâtes', 'long', false, 'feculents', array['hiver'], array['Faire dorer le bœuf avec l''oignon.', 'Ajouter le paprika et un peu d''eau.', 'Laisser mijoter 2h à couvert.', 'Servir avec les tagliatelles.'], null) returning id into rid;
  insert into recette_ingredient (recette_id, ingredient_id, quantite, unite)
    select rid, ing.id, v.quantite, v.unite from (values
    ('bœuf à braiser', 'viandes-poissons', false, 600, 'g'),
    ('paprika', 'epicerie', true, 2, 'cas'),
    ('oignon', 'legumes-fruits', true, 2, 'piece'),
    ('tagliatelles', 'epicerie', true, 200, 'g')
    ) as v(nom, categorie, fond, quantite, unite)
    join ingredient ing on ing.nom = v.nom and ing.categorie = v.categorie and ing.fond_de_placard = v.fond;
  insert into recette (nom, temps_preparation, vegetarien, accompagnement, saisons, etapes, user_id) values ('Moussaka grecque à l''agneau', 'long', false, 'legumes', array['automne'], array['Faire griller les tranches d''aubergine.', 'Préparer la viande hachée à la tomate.', 'Monter en couches, couvrir de béchamel.', 'Cuire 35 min au four à 180°C.'], null) returning id into rid;
  insert into recette_ingredient (recette_id, ingredient_id, quantite, unite)
    select rid, ing.id, v.quantite, v.unite from (values
    ('agneau haché', 'viandes-poissons', false, 400, 'g'),
    ('aubergines', 'legumes-fruits', false, 3, 'piece'),
    ('sauce tomate', 'epicerie', true, 300, 'g'),
    ('béchamel', 'epicerie', false, 400, 'ml')
    ) as v(nom, categorie, fond, quantite, unite)
    join ingredient ing on ing.nom = v.nom and ing.categorie = v.categorie and ing.fond_de_placard = v.fond;
  insert into recette (nom, temps_preparation, vegetarien, accompagnement, saisons, etapes, user_id) values ('Feijoada brésilienne, riz', 'long', false, 'feculents', array['hiver'], array['Faire revenir la poitrine et la saucisse.', 'Ajouter les haricots noirs et de l''eau.', 'Laisser mijoter 2h.', 'Servir avec le riz.'], null) returning id into rid;
  insert into recette_ingredient (recette_id, ingredient_id, quantite, unite)
    select rid, ing.id, v.quantite, v.unite from (values
    ('haricots noirs', 'epicerie', true, 500, 'g'),
    ('poitrine fumée', 'viandes-poissons', false, 200, 'g'),
    ('saucisse fumée', 'viandes-poissons', false, 2, 'piece'),
    ('riz basmati', 'epicerie', true, 200, 'g')
    ) as v(nom, categorie, fond, quantite, unite)
    join ingredient ing on ing.nom = v.nom and ing.categorie = v.categorie and ing.fond_de_placard = v.fond;
  insert into recette (nom, temps_preparation, vegetarien, accompagnement, saisons, etapes, user_id) values ('Bibimbap coréen au bœuf', 'long', false, 'legumes', null, array['Cuire le riz.', 'Faire sauter séparément le bœuf, les épinards et les carottes.', 'Cuire les œufs au plat.', 'Dresser tous les éléments sur le riz.'], null) returning id into rid;
  insert into recette_ingredient (recette_id, ingredient_id, quantite, unite)
    select rid, ing.id, v.quantite, v.unite from (values
    ('bœuf haché', 'viandes-poissons', false, 300, 'g'),
    ('épinards', 'legumes-fruits', false, 150, 'g'),
    ('carottes', 'legumes-fruits', true, 2, 'piece'),
    ('œufs', 'produits-frais', false, 2, 'piece'),
    ('riz basmati', 'epicerie', true, 200, 'g')
    ) as v(nom, categorie, fond, quantite, unite)
    join ingredient ing on ing.nom = v.nom and ing.categorie = v.categorie and ing.fond_de_placard = v.fond;
  insert into recette (nom, temps_preparation, vegetarien, accompagnement, saisons, etapes, user_id) values ('Bibimbap végétarien', 'long', true, 'legumes', null, array['Cuire le riz.', 'Faire sauter séparément le tofu, les épinards et les carottes.', 'Cuire les œufs au plat.', 'Dresser tous les éléments sur le riz.'], null) returning id into rid;
  insert into recette_ingredient (recette_id, ingredient_id, quantite, unite)
    select rid, ing.id, v.quantite, v.unite from (values
    ('tofu ferme', 'produits-frais', false, 250, 'g'),
    ('épinards', 'legumes-fruits', false, 150, 'g'),
    ('carottes', 'legumes-fruits', true, 2, 'piece'),
    ('œufs', 'produits-frais', false, 2, 'piece'),
    ('riz basmati', 'epicerie', true, 200, 'g')
    ) as v(nom, categorie, fond, quantite, unite)
    join ingredient ing on ing.nom = v.nom and ing.categorie = v.categorie and ing.fond_de_placard = v.fond;
  insert into recette (nom, temps_preparation, vegetarien, accompagnement, saisons, etapes, user_id) values ('Massaman curry de bœuf, riz', 'long', false, 'feculents', array['hiver'], array['Faire dorer le bœuf.', 'Ajouter la pâte de curry puis le lait de coco.', 'Ajouter les pommes de terre, laisser mijoter 1h30.', 'Servir avec le riz.'], null) returning id into rid;
  insert into recette_ingredient (recette_id, ingredient_id, quantite, unite)
    select rid, ing.id, v.quantite, v.unite from (values
    ('bœuf à braiser', 'viandes-poissons', false, 500, 'g'),
    ('pâte de curry massaman', 'epicerie', true, 60, 'g'),
    ('lait de coco', 'epicerie', true, 400, 'ml'),
    ('pommes de terre', 'legumes-fruits', true, 300, 'g'),
    ('riz basmati', 'epicerie', true, 200, 'g')
    ) as v(nom, categorie, fond, quantite, unite)
    join ingredient ing on ing.nom = v.nom and ing.categorie = v.categorie and ing.fond_de_placard = v.fond;
  insert into recette (nom, temps_preparation, vegetarien, accompagnement, saisons, etapes, user_id) values ('Korma de légumes à l''indienne', 'long', true, 'feculents', null, array['Faire revenir les épices korma.', 'Ajouter les légumes et le lait de coco.', 'Laisser mijoter 40 min.', 'Servir avec le riz.'], null) returning id into rid;
  insert into recette_ingredient (recette_id, ingredient_id, quantite, unite)
    select rid, ing.id, v.quantite, v.unite from (values
    ('chou-fleur', 'legumes-fruits', false, 1, 'piece'),
    ('carottes', 'legumes-fruits', true, 2, 'piece'),
    ('lait de coco', 'epicerie', true, 300, 'ml'),
    ('épices korma', 'epicerie', true, 1, 'cas'),
    ('riz basmati', 'epicerie', true, 200, 'g')
    ) as v(nom, categorie, fond, quantite, unite)
    join ingredient ing on ing.nom = v.nom and ing.categorie = v.categorie and ing.fond_de_placard = v.fond;
  insert into recette (nom, temps_preparation, vegetarien, accompagnement, saisons, etapes, user_id) values ('Poulet yassa sénégalais, riz', 'long', false, 'feculents', null, array['Faire mariner le poulet au citron et à l''oignon.', 'Griller le poulet.', 'Faire confire les oignons de la marinade.', 'Servir le poulet nappé d''oignons avec le riz.'], null) returning id into rid;
  insert into recette_ingredient (recette_id, ingredient_id, quantite, unite)
    select rid, ing.id, v.quantite, v.unite from (values
    ('cuisses de poulet', 'viandes-poissons', false, 4, 'piece'),
    ('oignon', 'legumes-fruits', true, 4, 'piece'),
    ('citron', 'legumes-fruits', false, 2, 'piece'),
    ('riz basmati', 'epicerie', true, 200, 'g')
    ) as v(nom, categorie, fond, quantite, unite)
    join ingredient ing on ing.nom = v.nom and ing.categorie = v.categorie and ing.fond_de_placard = v.fond;
  -- 3. Masquage ciblé des 154 nouvelles recettes pour le foyer d'Arnaud
  --    uniquement (les autres foyers, actuels ou futurs, voient le nouveau
  --    catalogue normalement). No-op si le compte n'existe pas ici.
  if v_foyer_arnaud is not null then
    insert into recette_masquee (foyer_id, recette_id, masquee_le)
    select v_foyer_arnaud, id, now() from recette where foyer_id is null
    on conflict do nothing;
  end if;
end $$;
