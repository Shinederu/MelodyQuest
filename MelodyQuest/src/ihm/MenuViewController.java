/*
 * Click nbfs://nbhost/SystemFileSystem/Templates/Licenses/license-default.txt to change this license
 * Click nbfs://nbhost/SystemFileSystem/Templates/javafx/FXMLController.java to edit this template
 */
package ihm;

import java.net.URL;
import java.util.ResourceBundle;
import javafx.event.ActionEvent;
import javafx.fxml.FXML;
import javafx.fxml.Initializable;
import javafx.scene.control.Button;

/**
 * FXML Controller class
 *
 * @author shine
 */
public class MenuViewController implements Initializable {

    @FXML
    private Button btn_Start;
    @FXML
    private Button btn_Settings;

    private Ihm refIhm;

    /**
     * Initializes the controller class.
     */
    @Override
    public void initialize(URL url, ResourceBundle rb) {
        // TODO
    }

    public void setRefIhm(Ihm ihm) {
        refIhm = ihm;
    }

    @FXML
    private void start(ActionEvent event) {
        refIhm.newGame();
    }

    @FXML
    private void settings(ActionEvent event) {
        refIhm.sout("AU REVOIR");
    }

}
