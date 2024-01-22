package app.presentation;

import app.helpers.JfxPopup;
import app.workers.Worker;
import java.net.URL;
import java.util.ResourceBundle;
import javafx.application.Platform;
import javafx.fxml.Initializable;
import app.workers.WorkerItf;
import javafx.event.ActionEvent;
import javafx.fxml.FXML;
import javafx.scene.control.Button;
import javafx.scene.control.CheckBox;
import javafx.scene.control.Label;
import javafx.scene.image.ImageView;
import javafx.scene.layout.BorderPane;

/**
 * Contrôleur de la vue principale.
 *
 * @author Shinederu
 */
public class MainCtrl implements Initializable {

    private WorkerItf wrk;
    @FXML
    private BorderPane bdp_Menu;
    @FXML
    private CheckBox chk_animes;
    @FXML
    private CheckBox chk_jeux_video;
    @FXML
    private BorderPane bdp_Jeu;
    @FXML
    private Label txtTheme;
    @FXML
    private Label txtTour;
    @FXML
    private ImageView imvReponse;
    @FXML
    private Label txtReponse;
    @FXML
    private Button btnReset;
    @FXML
    private Button btnPausePlay;
    @FXML
    private Button btnSolution;
    @FXML
    private CheckBox chk_dessins_animes;

    @Override
    public void initialize(URL url, ResourceBundle rb) {
        wrk = new Worker();
        chk_dessins_animes.setDisable(true);

    }

    public void quitter() {
        // faire qq chose avant de quitter
        // wrk.fermerBD();
        // System.out.println("Je vous quitte !");

        // obligatoire pour bien terminer une application JavaFX
        Platform.exit();
    }

    @FXML
    private void lancement(ActionEvent event) {
        //Changement du menu

        //vérifie la selection des catégories
        if (wrk.initialisation(chk_animes.isSelected(), chk_jeux_video.isSelected(), chk_dessins_animes.isSelected())) {

            bdp_Menu.setVisible(false);
            bdp_Jeu.setVisible(true);
            //wrk.jeu();

        } else {
            JfxPopup.displayError("Erreur !", "Aucune catégorie selectionnée !", "Merci de selectionner au moins 1 catégorie avant de lancer la partie.");

        }

    }

    @FXML
    private void reset(ActionEvent event) {
    }

    @FXML
    private void pausePlay(ActionEvent event) {
    }

    @FXML
    private void solution(ActionEvent event) {
    }

}
