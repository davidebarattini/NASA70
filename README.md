¨SUPSI 2026  
Corso d’interaction design, CV429.01  
Docenti: A. Gysin, G. Profeta  

Progetto 1: NASA 70 Archive

# Spacesuit evolution
Autore: Davide Barattini \
[NASA 70](https://davidebarattini.github.io/NASA70/)


## Introduzione e tema
NASA 70 Archive è una piattaforma web progettata per celebrare il settantesimo anniversario della NASA attraverso una raccolta di progetti realizzati a partire dagli archivi digitali dell'agenzia spaziale.
L'obiettivo del progetto è offrire un sistema di esplorazione che permetta agli utenti di scoprire relazioni tra contenuti diversi, superando una semplice organizzazione cronologica o alfabetica.
Attraverso l'utilizzo di tag e connessioni semantiche, la piattaforma mette in evidenza i legami esistenti tra i progetti, consentendo di navigare l'archivio seguendo temi, tecnologie, missioni e argomenti condivisi.
Il progetto trasforma quindi l'archivio in una rete di conoscenze interconnesse, favorendo una modalità di scoperta libera e non lineare.


## Riferimenti progettuali
[<img src="doc/Figma.jpg" width="200" alt="Supplemento al dizionario italiano">]()
[<img src="doc/Framer.jpg" width="200" alt="Supplemento al dizionario italiano">]()
[<img src="doc/Apple.png" width="200" alt="Supplemento al dizionario italiano">]()\
Per la progettazione dell'interfaccia sono stati presi come riferimento diversi prodotti digitali esistenti.
Apple ha ispirato il sistema di hotspot interattivi, utilizzati per evidenziare e approfondire specifici elementi delle tute spaziali direttamente all'interno della visualizzazione.
Figma e Framer hanno invece influenzato la struttura dell'interfaccia, basata su un layout a tre colonne che separa navigazione, contenuto principale e pannello di approfondimento, favorendo un'esplorazione chiara e organizzata delle informazioni.


## Design dell’interfaccia e modalità di interazione
L'esperienza è suddivisa in due modalità principali.\
[Archivio]
La prima schermata presenta tutti i progetti sotto forma di archivio consultabile.
Ogni progetto include:
immagine di anteprima, titolo, autore, anno di pubblicazione, descrizione
L'utente può ordinare e cercare i progetti per individuare rapidamente contenuti di interesse.\

[<img src="doc/Project_List.png" width="500" alt="Magic trick">]()

[Connessioni]
La seconda modalità di navigazione permette di visualizzare i progetti attraverso una mappa relazionale.
Ogni progetto viene rappresentato da un cerchio. La dimensione del cerchio varia in base alla quantità di tag che quel progetto ha in comune con gli altri: più un progetto condivide tag con il resto dell’archivio, più viene rappresentato in modo visivamente rilevante.
La disposizione dei cerchi non è casuale: i progetti con più tag in comune tendono ad avvicinarsi tra loro, creando gruppi tematici. In questo modo l’utente può individuare rapidamente quali progetti sono più collegati, quali temi ricorrono con maggiore frequenza e quali contenuti occupano una posizione più centrale all’interno dell’archivio.
In basso troviamo i 10 tag più utilizzati, che una volta cliccato su uno di esso, quesat lista si aggiorna mostrando,a loro volta, i 10 tag piu utilizzati di quei progetti selezionati.
Questa visualizzazione trasforma l’archivio in una rete esplorabile, dove la relazione tra i progetti diventa parte dell’esperienza di navigazione.\

[<img src="doc/Connections.png" width="500" alt="Magic trick">]()


## Tecnologia usata
[Gestione]
Tutti i progetti dell'archivio sono raccolti in un dataset JSON. Ogni elemento contiene le informazioni necessarie per la visualizzazione e per la generazione delle connessioni tra i contenuti.
```JavaScript
{
  id: "spacesuit-evolution",
  title: "Spacesuit Evolution",
  author: "Davide Barattini",
  year: "2026",
  description:
    "Interactive exploration of NASA spacesuits throughout different missions.",
  image: "img/spacesuit.jpg",
  tags: [
    "spacesuits",
    "apollo",
    "history",
    "technology",
    "exploration"
  ]
}
```
I tag rappresentano l'elemento centrale del sistema, poiché vengono utilizzati sia per il filtraggio dei contenuti sia per la costruzione delle relazioni tra i progetti.\

[Archivio]
La pagina principale viene costruita dinamicamente a partire dal dataset. Per ogni progetto viene generata una card contenente le principali informazioni e i relativi tag.
```JavaScript
projects.forEach(project => {
  const card = document.createElement("article");
  card.className = "project-card";

  card.innerHTML = `
    <img src="${project.image}" alt="${project.title}">
    <h3>${project.title}</h3>
    <p>${project.author}</p>
    <p>${project.description}</p>
    <div class="tags">
      ${project.tags.map(tag =>
        `<span>${tag}</span>`
      ).join("")}
    </div>
  `;

  archiveGrid.appendChild(card);
});
```
Questo approccio permette di aggiornare facilmente l'archivio aggiungendo nuovi elementi al dataset senza intervenire sulla struttura dell'interfaccia.\

[Connessioni]
La modalità Explore genera automaticamente una rete di relazioni confrontando i tag condivisi tra i progetti presenti nell'archivio.
```JavaScript
const links = [];

projects.forEach(source => {
  projects.forEach(target => {

    if (source.id === target.id) return;

    const sharedTags = source.tags.filter(tag =>
      target.tags.includes(tag)
    );

    if (sharedTags.length > 0) {
      links.push({
        source: source.id,
        target: target.id,
        weight: sharedTags.length
      });
    }

  });
});
```
Il numero di tag condivisi determina la forza della relazione tra due progetti. Queste informazioni vengono successivamente utilizzate da D3.js per costruire una visualizzazione relazionale in cui i progetti più affini tendono a posizionarsi vicini, mentre quelli meno correlati occupano aree più distanti della rete.
## Target e contesto d’uso
Il progetto è rivolto a:
- pubblico generalista
- appassionati di spazio
- utenti curiosi interessati alla tecnologia e alla storia
Il contesto principale è la navigazione web, in particolare su desktop, dove è possibile esplorare con maggiore precisione i dettagli delle tute e interagire con i punti informativi.
L’esperienza è pensata come esplorazione libera, associata ad una timeline.
