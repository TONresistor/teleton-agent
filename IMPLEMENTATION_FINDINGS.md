# Harness — lot minimal retenu

Branche `dev`, base `2ef6b7514e6fbdf3034b880e1e94a5933a3c48bc`. Lot organisé en six commits locaux sur `dev` (cinq correctifs et ce suivi). Aucun push ni déploiement.

## Décision de périmètre

À la demande de l’utilisateur, l’ancien lot large est retiré. Les corrections conservées sont uniquement : doublons après compaction/streaming, priorité et pondération RAG, endpoints locaux/fallbacks, écritures atomiques, statut du Dashboard, prise atomique d’une tâche.

Pas de migration : schéma **1.25.0** de la base. Configuration, API/SDK publics, règles d’autorisation, journal d’actions, politique d’annulation/reprise et outils financiers de la base conservés. Aucun contrôle de budget supplémentaire, nouvelle table, télémétrie ou infrastructure de reprise.

Les changements de comportement attendus se limitent aux bugs corrigés : un message final n’est envoyé qu’une fois ; une tâche active ne redémarre pas sur un second déclenchement ; un modèle local est résolu sur son endpoint configuré ; le badge reflète le statut reçu. Cela ne constitue pas une preuve absolue de zéro régression.

## Sauvegarde du travail retiré

L’ancien diff et ses fichiers ajoutés sont conservés hors dépôt :

`/var/folders/38/_m7jmvt141sg56nmrdhhdxbh0000gn/T/teleton-harness-before-minimal-44dwfsxk`

`changes.patch` contient le diff des fichiers suivis ; `files/` conserve les versions de tous les fichiers modifiés/ajoutés. Cette sauvegarde sert à reprendre éventuellement un lot plugins/MCP séparé ; elle n’est pas dans le code actif.

## Suivi des 33 IDs

| ID | Statut actuel | Périmètre exact |
|---|---|---|
| F01 | Retiré | Pas de nouveau budget du payload ni arrêt local ajouté. |
| F02 | Retiré | Compaction et preuves : comportement de la base rétabli. |
| F03 | Conservé | Le message courant n’est plus ajouté deux fois après compaction. |
| F04 | Retiré | Troncature/rétention/artefacts de la base conservés. |
| F05 | Conservé | Question actuelle avant l’historique dans la requête RAG. |
| F06 | Conservé, partiel | Pondération des candidats vectoriels corrigée dans les deux moteurs ; autres changements RAG retirés. |
| F07 | Retiré | Pas de nouveaux statuts publics de run ni règles de fin ajoutées. |
| F08 | Retiré | Pas de nouvelle définition de réussite des tâches. |
| F09 | Conservé, partiel | Prise atomique pending → in_progress et contrôle du retour dans le scheduler. Pas de nouvelle annulation/reprise. |
| F10 | Conservé, partiel | Les drafts ne publient plus de messages définitifs ; une publication finale. Reçus/journal/transport modifiés retirés. |
| F11 | Hors périmètre | Aucune modification TON, DEX, DNS financier ou SDK financier. |
| F12 | Retiré | Aucun inbox, outbox ou mécanisme de reprise durable ajouté. |
| F13 | Retiré | Budgets, timers et coordination de la base rétablis. |
| F14 | Conservé, partiel | Modèles locaux séparés par endpoint, découverte des fallbacks locaux et utility auto résolu. Démarrage Gocoon inchangé. |
| F15 | Retiré | Pas de snapshot par session persistant ni nouvelle table mémoire. |
| F16 | Mis de côté | Lifecycle, drain et migrations plugins de la base ; ancien travail disponible dans la sauvegarde. |
| F17 | Conservé, partiel | Écritures atomiques config/core memory, format inchangé, propriétaire et permissions existantes préservés ; nouveaux fichiers en 0600. |
| F18 | Mis de côté | MCP de la base ; correctifs précédents disponibles pour un lot distinct. |
| F19 | Retiré | Catégories exec, identité, déduplication et rétention d’actions de la base rétablies. |
| A01 | Réduit | Seulement les régressions des corrections conservées : intégration, endpoints locaux et fichiers atomiques. Seuils inchangés. |
| A02 | Choix conservé | Pas de moteur de mission autonome. |
| A03 | Retiré | Comptage et API de consommation de la base ; aucune table model_calls ajoutée. |
| A04 | Retiré | Traces et routes de supervision de la base rétablies. |
| A05 | Mis de côté | Hooks et types SDK de la base rétablis. |
| A06 | Différé | Aucune instrumentation/optimisation worker ajoutée. |
| A07 | Retiré | Indexation, provenance et stratégie de déduplication mémoire de la base rétablies. |
| A08 | Retiré | Rappel d’autorisation et traitement des fichiers de la base rétablis. |
| A09 | Retiré | Commandes et paramètres exec de la base : aucune nouvelle restriction. |
| A10 | Conservé, partiel | Seulement l’écriture atomique de core memory. Cache, pagination, nettoyage et API de la base rétablis. |
| A11 | Retiré | Marketplace, OpenAPI, HTTP client et API de la base ; pas de gestionnaire d’opérations ajouté. |
| A12 | Retiré | Vision, téléchargement et audio de la base rétablis. |
| A13 | Conservé, partiel | Dashboard sur le statut existant partagé ; état indisponible si connexion absente. Aucun nouveau polling/endpoint. |
| A14 | Mis de côté | Distribution, Docker et documentation de déploiement de la base rétablis ; ancien travail sauvegardé. |

## Dépendances et validation

- F03/F10/F09 : régressions dans `src/agent/__tests__/harness-integration.test.ts`, réduites à trois scénarios réels avec effets simulés.
- F14 : resolver, préparation de requête, empreinte de cible et ProviderRuntime ; deux scénarios locaux simulés.
- F17/A10 : helper atomique partagé, écritures de config/core memory ; test d’échec de rename, symlink et permissions. Le mock mémoire du test SOUL reste adapté à cette écriture.
- F05/F06 : corrections locales des requêtes/classements, aucune nouvelle provenance ni réindexation.
- A13 : réutilise le store de statut existant ; aucune route backend modifiée.

Validation du lot minimal terminée :

- Suite générale : 1 998 réussites / 1 999 ; unique échec dû au mock startTask ne renvoyant pas la tâche revendiquée. Mock adapté au contrat réel ; reprise ciblée scheduler/providers : 4/4 réussites. Pas de seconde suite générale.
- Typechecks produit, tests et frontend : réussis.
- Lint global, build SDK rétabli au HEAD et git diff --check : réussis.
- Schéma, journal d’actions, registre, routes API/WebUI, SDK, finance et plugins/MCP : aucun diff résiduel.
- 23 fichiers concernés : 17 fichiers produit, 5 fichiers de tests et ce suivi. Les fichiers déjà suivis totalisent environ 100 lignes ajoutées et 60 supprimées ; les nouveaux fichiers sont le helper atomique, trois tests ciblés et ce document.
- Logs : /tmp/teleton-minimal-{tests,last-tests,types,test-types,web-types,lint,sdk}.log.

Les tests protègent le périmètre corrigé ; ils ne constituent pas une garantie universelle d’absence de régression. Aucun déploiement ni modification des données utilisateur n’a été effectué.


## Commits locaux

| Commit | Contenu |
|---|---|
| `b41b0df` | Doublons de messages et exécution des tâches |
| `f801091` | Priorité de requête et pondération RAG |
| `1714f45` | Résolution des modèles locaux par endpoint |
| `aaad951` | Écritures atomiques config/core memory |
| `192a745` | Statut réel du Dashboard |
| Présent commit | Suivi du périmètre et des exclusions |

Les hooks de commit du dépôt ont exécuté le typecheck ; ESLint/Prettier ont été appliqués aux fichiers TypeScript concernés par lint-staged. Le frontend reste couvert par son typecheck déjà consigné ci-dessus.
