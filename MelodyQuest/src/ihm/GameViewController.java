/*
 * Click nbfs://nbhost/SystemFileSystem/Templates/Licenses/license-default.txt to change this license
 * Click nbfs://nbhost/SystemFileSystem/Templates/javafx/FXMLController.java to edit this template
 */
package ihm;

import java.net.URL;
import java.util.ResourceBundle;
import javafx.fxml.FXML;
import javafx.fxml.Initializable;
import javafx.scene.control.Button;
import javafx.scene.image.ImageView;
import javafx.scene.text.Text;

/**
 * FXML Controller class
 *
 * @author shine
 */
public class GameViewController implements Initializable {

    @FXML
    private Button btn_Leave;
    @FXML
    private Text txt_Round;
    @FXML
    private Text txt_Theme;
    @FXML
    private Button btn_PausePlay;
    @FXML
    private Button btn_Reset;
    @FXML
    private Button btn_SoluceNext;
    @FXML
    private Text txt_Soluce;
    @FXML
    private ImageView img_Soluce;

    /**
     * Initializes the controller class.
     */
    @Override
    public void initialize(URL url, ResourceBundle rb) {
        // TODO
    }    
    
}
