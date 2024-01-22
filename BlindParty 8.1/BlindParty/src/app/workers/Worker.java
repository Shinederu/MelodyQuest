package app.workers;

import app.beans.Categories;
import app.beans.Musique;
import java.io.File;
import java.util.ArrayList;
import java.util.List;

/**
 * Implémentation de la couche "métier" de l'application.
 *
 * @author ...
 */
public class Worker implements WorkerItf {

    //Attributs
    private List<Musique> listeTouteLesMusiques;
    private List<Musique> playlist;
    private Musique musiqueEnCours;
    private int nbrTour;
    private static final String CHEMIN_DOSSIER_RESSOURCE = "src/resources/sounds/animes";

    //Constructeur
    public Worker() {
        this.listeTouteLesMusiques = new ArrayList<Musique>();
        initDatas();
        nbrTour = 0;
    }

    public boolean initialisation(boolean animes, boolean jeux_videos, boolean dessins_animes) {

        //Variable de retour
        boolean estInitialiser = false;

        //création de la liste de musique utilisée en jeu
        playlist = new ArrayList<Musique>();

        //Ajout des musiques dans la liste en fonction des selection
        for (Musique selection : listeTouteLesMusiques) {

            if (animes && selection.getCategorie().equals(Categories.ANIMES)) {
                playlist.add(selection);
            } else if (jeux_videos && selection.getCategorie().equals(Categories.JEUX_VIDEOS)) {
                playlist.add(selection);
            } else if (dessins_animes && selection.getCategorie().equals(Categories.DESSINS_ANIMES)) {
                playlist.add(selection);
            }
        }

        //Vérifie que la liste de musique n'est pas vide
        if (playlist.size() > 0) {
            System.out.println("La liste à été créée");
            estInitialiser = true;
        }

        return estInitialiser;
    }

    public boolean initDatas() {
        boolean comeBack = false;

        // Créez une instance de File avec le chemin d'accès du dossier
        File directory = new File(CHEMIN_DOSSIER_RESSOURCE);
        
        // Vérifiez si le chemin d'accès est un dossier
        if (directory.isDirectory()) {
            // Liste tous les fichiers dans le dossier
            File[] files = directory.listFiles();

            // Affiche le nom de chaque fichier
            for (File file : files) {
                System.out.println("Fichier : " + file.getName());
            }
            comeBack = true;
        } else {
            System.out.println(CHEMIN_DOSSIER_RESSOURCE + " n'est pas un dossier.");
        }

        return comeBack;
    }

}
