/*
 * Click nbfs://nbhost/SystemFileSystem/Templates/Licenses/license-default.txt to change this license
 * Click nbfs://nbhost/SystemFileSystem/Templates/Classes/Class.java to edit this template
 */
package ihm;

import ctrl.ItfCtrlIhm;
import java.io.IOException;
import javafx.application.Platform;
import javafx.fxml.FXMLLoader;
import javafx.scene.Parent;
import javafx.scene.Scene;
import javafx.scene.image.Image;
import javafx.stage.Stage;
import javafx.stage.WindowEvent;

/**
 *
 * @author shine
 */
public class Ihm {

    private ItfCtrlIhm refCtrl;
    private Scene principalScene;
    private Stage mainStage;
    private Parent root;
    private MenuViewController ViewController;

    public Ihm() {
        //gameViewController = new GameViewController();
        ViewController = new MenuViewController();
    }

    public void startIhm() {
        System.out.println("IHM START");

        try {
            Platform.startup(() -> {
                try {
                    FXMLLoader loader = new FXMLLoader(getClass().getResource("MenuView.fxml"));
                    mainStage = new Stage();
                    root = loader.load();
                    ViewController = loader.getController();
                    principalScene = new Scene(root);
                    mainStage.setScene(principalScene);
                    mainStage.setTitle("Melody Quest");
                    mainStage.getIcons().add(new Image("./res/img/icon.png"));
                    mainStage.setOnCloseRequest((WindowEvent e) -> {
                        refCtrl.quit();
                    });
                    mainStage.show();
                } catch (IOException ex) {
                    System.out.println("Can't start the IHM because : " + ex);
                    Platform.exit();
                }
                ViewController.setRefIhm(this);
            });
        } catch (Exception e) {
            System.out.println("IHM Error: " + e.getMessage());
        }

    }

    public void newGame() {
    refCtrl.newGame();
    }

    public void sout(String e) {
        System.out.println(e);
    }

    public void setRefCtrl(ItfCtrlIhm refCtrl) {
        this.refCtrl = refCtrl;
    }

}
