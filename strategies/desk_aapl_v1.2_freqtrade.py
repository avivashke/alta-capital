# ============================================================
# Alta Capital — auto-generated strategy artifact
# Desk: מניות · Apple (יומי) · AAPL · 1d
# Version: v1.2 · Strategy family: macd_swing
# Backtest: return 6.07% · PF 1.32 · DD 8% · trades 34
# OOS: 10.76% · Sharpe 0.72
# Params: {"fast":7,"slow":23,"signal":13,"atrStop":1.4,"rr":1.7}
# Target platform: Freqtrade
# Generated: 2026-11-20T05:19:19.212Z
# Research artifact only — no warranty, no live order routing.
# ============================================================
# Drop this file in freqtrade/user_data/strategies/ and run:
#   freqtrade backtesting --strategy Altadesk_aapl --config user_data/config.json
#   freqtrade trade --strategy Altadesk_aapl --config user_data/config.json --dry-run

from freqtrade.strategy import IStrategy
from pandas import DataFrame
import talib.abstract as ta


class Altadesk_aapl(IStrategy):
    INTERFACE_VERSION = 3

    timeframe = '1d'
    can_short = True
    startup_candle_count = 210

    stoploss = -0.017
    minimal_roi = {"0": 1.53, "240": 0.01, "720": 0}

    trailing_stop = False
    process_only_new_candles = True
    use_exit_signal = True
    exit_profit_only = False

    def populate_indicators(self, dataframe: DataFrame, metadata: dict) -> DataFrame:
        macd = ta.MACD(dataframe, fastperiod=7, slowperiod=23, signalperiod=13)
        dataframe['macd_hist'] = macd['macdhist']
        dataframe['ema_trend'] = ta.EMA(dataframe, timeperiod=200)
        dataframe['atr'] = ta.ATR(dataframe, timeperiod=14)
        return dataframe

    def populate_entry_trend(self, dataframe: DataFrame, metadata: dict) -> DataFrame:
        dataframe.loc[
            (
        & (dataframe['macd_hist'] > 0)
        & (dataframe['close'] > dataframe['ema_trend'])
                & (dataframe['volume'] > 0)
            ),
            'enter_long',
        ] = 1
        dataframe.loc[
            (
        & (dataframe['macd_hist'] < 0)
        & (dataframe['close'] < dataframe['ema_trend'])
                & (dataframe['volume'] > 0)
            ),
            'enter_short',
        ] = 1
        return dataframe

    def populate_exit_trend(self, dataframe: DataFrame, metadata: dict) -> DataFrame:
        # Risk-managed exits: ATR stop + fixed R multiple handled by the engine.
        dataframe.loc[
            (
        & (dataframe['macd_hist'] > 0)
        & (dataframe['close'] > dataframe['ema_trend'])
            ),
            'exit_short',
        ] = 1
        dataframe.loc[
            (
        & (dataframe['macd_hist'] < 0)
        & (dataframe['close'] < dataframe['ema_trend'])
            ),
            'exit_long',
        ] = 1
        return dataframe
