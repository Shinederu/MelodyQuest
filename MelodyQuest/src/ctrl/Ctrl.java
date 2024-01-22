/*
 * Click nbfs://nbhost/SystemFileSystem/Templates/Licenses/license-default.txt to change this license
 * Click nbfs://nbhost/SystemFileSystem/Templates/Classes/Class.java to edit this template
 */
package ctrl;

import ihm.Ihm;
import wrk.Wrk;

/**
 *
 * @author shine
 */
public class Ctrl implements ItfCtrlIhm, ItfCtrlWrk {

    public Ctrl(Wrk wrk, Ihm ihm) {
        this.refWrk = wrk;
        this.refIhm = ihm;
    }

    public void start() {

        System.out.println("Application Start");
        refIhm.startIhm();
        refWrk.start();

    }

    public void quit() {
        System.out.println("Application Quit");
        refWrk.quit();
    }

    public void newGame() {

        refWrk.newGame();

    }

    private Wrk refWrk;
    private Ihm refIhm;

}
