-- Migration — saisons des recettes (#23, P12).
-- Date : 2026-06-10
--
-- Ajoute recette.saisons (text[], NULL/vide = disponible toute l'année). Le
-- catalogue global (user_id IS NULL) étant en lecture seule (RLS), on l'auto-
-- tague ici par heuristique de NOM d'ingrédient (table produit→saisons), via les
-- UPDATE ci-dessous GÉNÉRÉS par scripts/generer-saisons-recettes.mjs (miroir de
-- lib/saisons.ts — toute évolution de la table produit→saisons doit être
-- répercutée dans le script puis régénérée ici ; cf. piège CLAUDE.md).
--
-- Saison d'une recette = INTERSECTION des saisons de ses produits saisonniers
-- (aromates / produits de garde = toute l'année, ne contraignent pas) ;
-- intersection vide → toute l'année (recette laissée NULL). Imparfait, « à
-- compléter ». Scopé user_id IS NULL : ne touche pas les recettes perso (gérées
-- par le formulaire) ; couvre le rejeu sur base neuve (après le seed).

alter table recette
  add column saisons text[]
  check (saisons is null or saisons <@ array['ete', 'automne', 'hiver', 'printemps']::text[]);

-- Tagging du catalogue global (généré) :
update recette set saisons = '{ete}' where nom = 'Poulet riz tomates' and user_id is null;
update recette set saisons = '{automne,hiver}' where nom = 'Poulet choux-fleur' and user_id is null;
update recette set saisons = '{automne,hiver}' where nom = 'Poulet brocolis' and user_id is null;
update recette set saisons = '{automne,hiver}' where nom = 'Poulet fondue de poireaux' and user_id is null;
update recette set saisons = '{ete}' where nom = 'Poulet basquaise' and user_id is null;
update recette set saisons = '{automne,hiver}' where nom = 'Filet mignon poireaux moutarde' and user_id is null;
update recette set saisons = '{ete}' where nom = 'Rougail saucisses' and user_id is null;
update recette set saisons = '{ete}' where nom = 'Chili con carne' and user_id is null;
update recette set saisons = '{ete}' where nom = 'Sauté de veau' and user_id is null;
update recette set saisons = '{automne,hiver}' where nom = 'Rôti de porc betteraves' and user_id is null;
update recette set saisons = '{automne,hiver}' where nom = 'Hachoux parmentier canard' and user_id is null;
update recette set saisons = '{automne,hiver}' where nom = 'Pot au feu' and user_id is null;
update recette set saisons = '{ete}' where nom = 'Osso bucco pâtes' and user_id is null;
update recette set saisons = '{ete}' where nom = 'Poisson piperade' and user_id is null;
update recette set saisons = '{ete}' where nom = 'Poisson papillote petits pois' and user_id is null;
update recette set saisons = '{ete}' where nom = 'Pâtes chorizo' and user_id is null;
update recette set saisons = '{printemps,automne}' where nom = 'Lasagnes chèvre épinards' and user_id is null;
update recette set saisons = '{automne,hiver}' where nom = 'Lasagne reblochon butternut' and user_id is null;
update recette set saisons = '{automne,hiver}' where nom = 'Gratin crozets butternut' and user_id is null;
update recette set saisons = '{automne,hiver}' where nom = 'Gratin crozets choux-fleur' and user_id is null;
update recette set saisons = '{printemps,automne}' where nom = 'Quiche chèvre épinards' and user_id is null;
update recette set saisons = '{ete}' where nom = 'Tarte tomates' and user_id is null;
update recette set saisons = '{ete}' where nom = 'Tarte thon tomates' and user_id is null;
update recette set saisons = '{ete}' where nom = 'Wraps' and user_id is null;
update recette set saisons = '{ete}' where nom = 'Burger maison frites' and user_id is null;
update recette set saisons = '{automne,hiver}' where nom = 'Brownie brocolis' and user_id is null;
update recette set saisons = '{ete}' where nom = 'Dal lentilles' and user_id is null;
update recette set saisons = '{ete}' where nom = 'Taboulé' and user_id is null;
update recette set saisons = '{ete}' where nom = 'Curry végétarien' and user_id is null;
update recette set saisons = '{ete}' where nom = 'Bruschetta' and user_id is null;
update recette set saisons = '{ete}' where nom = 'Salade César' and user_id is null;
update recette set saisons = '{automne,hiver}' where nom = 'Poireaux jambon' and user_id is null;
