/*
 * Click nbfs://nbhost/SystemFileSystem/Templates/Licenses/license-default.txt to change this license
 * Click nbfs://nbhost/SystemFileSystem/Templates/Classes/Class.java to edit this template
 */
package wrk;

import ctrl.ItfCtrlWrk;

/**
 *
 * @author shine
 */
public class Wrk {

    private WrkDataBase wrkDB;

    public Wrk() {
    }

    public void setRefCtrl(ItfCtrlWrk refCtrl) {
        this.refCtrl = refCtrl;
    }

    public void start() {

        wrkDB = new WrkDataBase();
        wrkDB.dbConnecter();
        wrkDB.dbEstConnectee();
    }

    public void quit() {

        if (wrkDB.dbEstConnectee()) {
            wrkDB.dbDeconnecter();
        }

    }

    public void newGame() {
        System.out.println("[LOG] - NewGame");

    }

    private ItfCtrlWrk refCtrl;

}
